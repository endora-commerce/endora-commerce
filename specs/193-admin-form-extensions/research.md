# Research — Admin form extensions (193)

Architect rulings, R-1 to R-20. Each states the decision, the rationale and the rejected
alternatives. The owner questions are OQ-193-1 to OQ-193-6 in `spec.md`. The rulings here do not
depend on them unless they say so.

Measured against `origin/master` at `419ffad74`.

## R-1: Field sets are declared in contracts, beside the write schemas

**Decision.** Each host entity that offers form extensions declares a **field set** with
`defineFieldSet` in `@endora-commerce/contracts`, in the owner's domain file family (for example
`packages/contracts/src/organization-form.ts`, beside `organization-hooks.ts`). It also declares one
or more **admin forms** with `defineAdminForm`, which are layouts over that field set. Both are plain
data plus TypeScript literal types. The owner's manifest lists them (`fieldSets`, `adminForms`) so
that composition and the CLI can read them without loading backend or admin code, the reason 187
R-1 gives for `extends`.

**Rationale.** Principle II puts every cross-package shape in contracts. A field key is consumed by
the owner's admin, by other modules' admin layers and manifests, by the platform's composition
checks and by the server-side rule check, so it crosses every boundary in the system. A literal
union of keys makes an anchor or override on an unknown key a type error in the contributor's own
build, before any check runs.

**Rejected.**
- *A server-driven form schema that every module may modify* (Magento's UI-component XML plus data
  providers). The final form becomes unknowable statically, conflicts resolve as last-writer-wins,
  and it violates XV's "no silent conflict".
- *Deriving keys from the JSX.* A rendered form is not a declaration, and two forms of one entity
  would disagree about what a key means.
- *Deriving keys from the Zod body schema alone.* The schema carries types and bounds but not
  sections, order, `accepts` or writers. FR-003 holds the two in agreement instead.

## R-2: Field keys are contract surface

**Decision.** `contracts/form-field-declaration.md` §5 adds rows to
`specs/conventions/contract-surface.md`:

- Field-set id and form id: **frozen**, identity.
- Field key and section key: **stable**, identity.
- Value type: **stable**, read.
- `accepts`: **stable**, write. Widening is compatible; narrowing needs a deprecation release.
- Platform control ids: **stable**, identity.
- Format ids: **additive-only**.

A renamed key keeps the old one as a `deprecatedAliases` entry for one release (FR-071).

**Rationale.** An overlay anchored on `taxId` breaks silently if `taxId` becomes `vatNumber`.
`contract-surface.md` already governs exactly this kind of identifier that a consumer names, such
as hookable action ids and policy-point ids.

**Cost to core modules, stated plainly.** Adopting a form makes its keys a promise. Renaming or
removing one costs a deprecation release and an upgrade-note line. Changing a value type is a new
key. Narrowing `accepts` is a deprecation. Adding a field is free. The owner takes this cost per
form when it adopts, and the cost is why adoption is per form and opt-in (R-16) rather than
platform-wide.

## R-3: Slot fields are a new contribution kind, not zones

**Decision.** `AdminContributions` gains `fields: AdminFieldContribution[]`. A slot is parameterised
by `(fieldSet, forms?, anchor, position)`, which are data. The zone enum stays closed.

**Rationale.** `AdminZoneNameSchema`'s contract rejects a name computed from a field path, because
the two-way rendered-or-refused check compares names. A slot is a different thing: it takes part in
the host's value, validation, layout and Save, while a zone renders beside the form. Using zones for
slots would need one zone member per field, which is the openness the closed enum refuses.

**Rejected.**
- *Generalising `product.editor.field.after` to every form.* That zone adorns a field and writes
  nothing (protection toggles). Keeping adornment and input separate keeps the four PIM modules
  unchanged (FR-082).
- *Render hooks with integer priorities* (Sylius Twig Hooks). They render well, but persistence
  lives elsewhere and drifts from the rendering. Here the slot declaration and the hook that persists
  it belong to one module and are checked together (R-5).

## R-4: Ordering is relative, with a deterministic tie-break; conflicts are reported, not resolved silently

**Decision.**
- A slot anchors on a core field key, a section key, or a slot of its own module. A field anchor
  takes `before` or `after`, and a section anchor takes `start` or `end`.
- Order within one (anchor, position) is `(weight, moduleId, localKey)` ascending.
- A slot anchored on a field hidden by an override renders in that field's place. This is how the
  replacement pattern positions its field, with no extra position kind.
- The check reports two slots from different modules with equal `(anchor, position, weight)` as
  `ambiguous-slot-order` (a warning). Unknown anchors and foreign-slot anchors are refusals.

**Rationale.** XV requires either a refusal or "one documented, explicit precedence rule". The
tie-break is that rule, so equal weights are legal. The warning makes the authors aware without
blocking an instance that combines two independent packages.

**Rejected.**
- *Absolute `sortOrder` integers* (Magento). They couple every author to every other author's
  numbers, and nothing reports a collision.
- *Anchoring on other modules' slots.* It would create chains across packages, so one package's
  rename breaks another's layout.
- *A `formSlotOrder` override in `divergence.ts`.* No case needs it yet, given weights and the
  tie-break (IV). It can be added later on `commandHookOrder`'s precedent.

## R-5: Slot values travel in `extensions` and are written by the slot module's hook

**Decision.** The form sends `extensions: { <moduleId>: { <localKey>: value } }` in the host's own
create or update request. The host forwards it to `Command.extensions` (176). The slot module writes
it with a `beforeCommit` hook on the host's hookable actions, using `fieldSlotHook` (FR-014), into
its own side table (187) or its own D2 columns (178). The host's admin create and update body
schemas gain an optional `extensions` field. That is the HTTP field 178's OD-178-6 deferred "until a
host form can carry zone-contributed fields", and this feature is that form.

**Rationale.** Everything is already built: the carrier (176), the unclaimed-key refusal, the
atomic create (187 OR-4), one audit entry with `extensions.<moduleId>.changedFields`, and presence
skipping. The host's version check covers the extension write because it runs in the same
transaction. The XIII thin layer is untouched.

**Rejected.**
- *The slot saves itself through its own route*, as a save-session participant. That means two
  Commands and two audit entries for one operator Save, a window in which the host row exists
  without the slot row, and no atomic create.
- *Host-owned generic JSON columns for extension values.* That would put another module's data in a
  core table and violate XV's schema rungs.

## R-6: Reading slot values (owner question OQ-193-1)

The architect recommends option A: a side-table loader opts into admin reads (`adminReads: true`),
and the adopting host's admin detail route serves the value on `?extensions=<moduleId>`
(`ExtensionsQuerySchema`, already used by `organizations` for D2). 187 R-17 recorded the
implementation, the collision rule and the estimated cost (one module may not serve both D2 columns
and a loader under one key on one host), and its rationale for deferral was that no admin consumer
existed. This feature is that consumer. The ruling belongs to the owner because it reopens OR-10.

## R-7: Overrides are manifest data, enforced by the server and served to the admin

**Decision.** A deployment's overlay module declares `formOverrides` in its manifest. The
declaration is pure data. Composition validates it (FR-021). The server enforces its rules (R-9),
and `GET /api/v1/admin/forms` serves the effective presentation to the admin. Code-bearing behaviour,
such as masks and derivations, lives in the admin layer as `fieldBehaviours`, and it constrains the
UI only (R-11).

**Rationale.** One declaration, read by both ends, cannot disagree with itself. This is the issue's
core criticism of Magento, where a hidden field still validates, and of Sylius, where form, template
and entity drift. A manifest is readable without loading code, so composition can refuse it before
anything registers, and an overlay module's presence gates it with no extra wiring (XVII).

**Rejected.**
- *Overrides in `divergence.ts`.* That file records what a deployment did and grants what it
  allows. Overrides need label keys resolved in a bundle, and a declaring module whose presence
  gates them. `divergence.ts` belongs to no module, so its overrides could never be switched off.
- *Bundling overrides into the admin build only.* The server would need a second copy to enforce
  the rules, and the frontends would hard-code presence (XVII forbids that).
- *A runtime Settings source.* See OQ-193-6. The shape is kept pure data so that a source of this
  kind can be added later.

## R-8: What a field accepts, and how overrides combine

**Decision.**
- Each field declares `accepts`: a subset of `label`, `help`, `placeholder`, `position`, `default`,
  `readOnly`, `hidden`, `control`, `behaviour`, `visibleWhen`, `validation`, `requiredWhen` and
  `writePermission`. The helper `PRESENTATION_OVERRIDES` covers the first ten.
- `hidden` is refused on a field that core declares required (`hidden-required-field`).
- `default` is refused together with `hidden` (`default-on-hidden`). A default only pre-fills a
  visible create form, and a hidden field is never sent.
- A presentation attribute of one field has at most one overriding module per deployment
  (`override-conflict`).
- Validation tightenings compose by conjunction. Each one only narrows, so the conjunction is still
  a narrowing. An unsatisfiable pair, such as `minLength > maxLength` or an empty options
  intersection, is refused as `override-contradiction`.

**Rationale.** The owner opts each field in, so the owner keeps control of its contract (XV:
"contract-gated overrides"). Conjunction is safe because no tightening can loosen another, while
presentation has no meaningful merge.

**Rejected.**
- *Every field accepting everything by default.* A field whose writers do not project it cannot be
  enforced (R-9), and a field with domain meaning, such as `status`, should not be relabelled into
  something else.
- *Last-writer-wins for presentation.* XV forbids it.

## R-9: The server enforces the rules in a field-rule check inside the hook stage

**Decision.**
- The owner lists the field set's **writers**: each hookable action that writes the entity, with a
  projection from its `beforeCommit` hook data to `{ before, after, changed }` over the field keys
  (`contracts/field-rules.md` §2). It is registered with `ctx.fieldSets([…])`.
- For each writer, the platform runs one **field-rule check** first in that action's
  `beforeCommit` phase, before any module hook. The check evaluates the effective tightened rules,
  `requiredWhen`, the formats and `writePermission` against the projection.
- On any violation it throws `422 FIELD_RULE_VIOLATION` (or `403 FIELD_WRITE_FORBIDDEN`), and the
  transaction rolls back.
- The check reads hook data, writes nothing, and is therefore exempt from 176's ordering rule.
- A field that some writer does not project cannot accept `validation`, `requiredWhen` or
  `writePermission` (`accepts-unenforceable`).

**Rationale.** Every write path (the admin UI, the admin API, imports, ports and workers) runs the
owner's Command (XIII), so a check on the Command cannot be bypassed. This is the issue's "imports,
ports and the API cannot bypass it". Running it at the `beforeCommit` position reuses 176's
machinery: the uncommitted after-state, the rollback, and `HttpError` propagation. It adds no bus
stage.

Exempting it from ordering is sound. Hooks may not change the owner's state (176 §5), so the check
sees the same projection wherever it runs, and a refusal rolls back whatever ran before it. Without
the exemption, every override would force a `commandHookOrder` entry against every unrelated hook
on the action (`UnorderedCommandHooksError`).

`organization.tax_id.change` shows the coverage rule at work. Its hook data deliberately carries
no tax ID (audit-state list 1), so it cannot project `taxId`, and `taxId` therefore accepts
presentation overrides only, unless the owner adds the value to the hook data.

**Rejected.**
- *An `admit` command middleware.* It runs before the Command and sees no merged state, and it
  cannot know the record's after-state on a partial update.
- *Each host calling a validator by hand in its service*, as custom fields' `validateAndMerge`
  works. That makes enforcement depend on developer discipline per host, which is the failure XIII
  was written against.
- *Ordinary module hooks registered on the overlay's behalf.* They would hit the ordering refusal
  described above.

**Constitution.** No amendment is needed. The check is a declared refusal inside a declared
hookable action, which is XV's "declared command hooks" surface, and it writes nothing, as XIII's
middleware sentence requires of `admit`. A PATCH clarification that names "accepted field
overrides" in XV's bounded-surface list is recommended, to be bundled with the docs pass. It is not
required.

## R-10: Input controls declare an output type; the fit is checked at composition

**Decision.**
- `PLATFORM_INPUT_CONTROLS` in contracts holds the data half: `platform.text`, `platform.textarea`,
  `platform.email`, `platform.tel`, `platform.url`, `platform.number`, `platform.integer`,
  `platform.decimal`, `platform.switch`, `platform.select`, `platform.multiselect`,
  `platform.date`, `platform.country` and `platform.color`. Each entry has an `outputType` and an
  optional `format`. Admin-kit supplies the components.
- A module may declare `inputControls` in its manifest and `controls` in its admin layer, checked
  two ways.
- The fit is checked against `contracts/input-controls.md` §2. A control fits when its output type
  equals the field's value type, or when it is a `string`-output control with a format on a `string`
  field. A select fits a string or enum field and implies an `options` tightening. Every other pair
  is refused.
- Formats are platform formats (`email`, `tel`, `url`) or module formats, which need a validator
  registered with `ctx.fieldFormats`.

**Rationale.** A control decides what the value looks like, so an incompatible control would write
values the core contract refuses, or worse, values it accepts with a different meaning. Checking the
fit at composition turns a runtime surprise into a build refusal (XV). A control's implied validation
must also hold on the server, so a format without a server validator is refused rather than
trusted.

**Rejected.**
- *Controls that transform the value on the server* (normalise a phone number, for example). 189's
  rule that nothing transforms a Command's input applies in spirit. A control may normalise
  client-side, and the server validates only.
- *Free-form control-to-type mapping declared by each control.* The table is the contract, and a
  control does not get to decide that it fits.

## R-11: Behaviour: conditions are shared data; masks and derivations are UI-only code

**Decision.**
- **Conditions** (`visibleWhen`, `requiredWhen`) are a closed vocabulary: `equals`, `notEquals`,
  `in`, `isEmpty`, `isNotEmpty`, combined with `all`, `any` and `not`, with a depth of at most 4 and
  at most 16 leaves. One evaluator, `evaluateFieldCondition` in contracts, is a pure function with no
  dependency, and the form and the server both call it.
- A condition names core keys of the same field set, or the declaring module's own slot keys,
  because those are the only values the server-side check sees: the projection, and the module's own
  extension slice.
- **Masks** are admin code. A mask that must hold on the server pairs with a `validation.pattern` in
  the manifest override. The stored value is what the control emitted.
- **Derivations** are admin code that pre-fills the target while the operator has not edited it.
  The server never recomputes a core field. A deployment that needs an invariant writes a validation
  rule, or for its own slot field, computes the value in its own hook.

**Rationale.** The issue's rule is "every rule that must hold has a server-side counterpart". A
condition is a rule, so it is data with one evaluator. A mask or a derivation is an input aid and
not a rule. Pretending otherwise would need a server-side code path that rewrites core input, which
XV's bounded surface does not offer: a hook "extends the owner's write and never replaces it".

**Rejected.**
- *A general expression language* (JSON-logic or JavaScript strings). It is a new runtime
  dependency or an `eval`, and it far exceeds what the cases need (IV).
- *Server-side derivation of core fields.* It replaces the owner's write.
- *Conditions over other modules' slot fields.* The server cannot see another module's extension
  slice.

## R-12: Per-field write permission is server-side; hiding and read-only are presentation

**Decision.** `writePermission` is checked by the field-rule check, only for fields the Command
changed, using the kernel's `AdminPermissionChecker.hasPermission` for an admin actor and the key's
`scopes` for an API-key actor. A system actor is exempt, because it holds no permissions, the same
as with `requireAdmin`. The form renders a field read-only for an admin who lacks the permission.
`hidden`, `readOnly` and `visibleWhen` are never read by any endpoint (FR-062). Per-field **read**
access control is out of scope.

**Rationale.** The issue states that hiding is presentation and never access control. That
matches 175's ruling that a custom field's admin access level is a convenience and not access
control. A field that must be protected needs a permission the server checks, and it gets one.
Checking only changed fields keeps a full-record `PATCH` from an admin without the permission
working when it carries the stored value unchanged.

**Rejected.**
- *Read-only as enforcement.* An API caller cannot be told apart from the panel, which is 175's
  SD-2 argument.
- *Per-field read permissions in this feature.* That would change what every admin read, export and
  search returns per role, which is a separate feature with a far larger blast radius.

[NEEDS CLARIFICATION, for the plan rather than the owner: `CommandActor` carries no API-key id
today. The plan's task T-B6 establishes how the check obtains the key's scopes from the request
context, or records that API-key writes on such fields are refused until it can.]

## R-13: Trust tiers (OQ-193-2 decides the package row)

**Decision.** The capability table, using 189 `contracts/module-origin.md`'s words:

| Capability | core | deployment | package |
| --- | --- | --- | --- |
| slot fields on another module's field set | yes, by the field set's invitation | yes | yes |
| `formOverrides` on its **own** field set | not applicable (it edits its own declaration) | yes | yes |
| `formOverrides` on another module's field set | **no** (`foreign-override`) | yes, within `accepts` | only under a `formOverrideGrants` entry (OQ-193-2 A) |
| `inputControls` / `fieldFormats` | yes | yes | yes |
| `fieldBehaviours` on another module's field | no | yes, within `accepts.behaviour` | under the same grant as overrides |

Grants follow 189 §5 exactly. They name the package by module id **and** installed package name,
they grant one field set, they never change origin, and they are refused when misdirected (core or
deployment) or stale.

**Rationale.** This is the ladder's "uninvited" row. The field set's `accepts` list is the owner's
invitation, and the deployment owns its instance. A core module that changes another core module's
form is an edit to the owner, because core is one product.

## R-14: Off-state

**Decision.** Everything a module contributes is gated on its effective presence: slots, overrides,
controls, formats, behaviours and grants. The server computes the effective forms from the
composition and `effectiveState`. The admin removes slots and controls through the existing
presence predicate (`isSurfaceVisible`) and takes overrides only from the server. A selected control
whose module is off falls back to the field's core control, and its format is no longer enforced,
because the declaring override counts as absent. A slot module's side-table rows are kept (187
FR-061).

**Rationale.** XVII says that off means absent on all four surfaces, and it forbids hard-coding
presence in frontends. A deployment's tightened rule that survived switching its module off would be
behaviour from a module that is "not installed".

## R-15: The field replacement pattern (documented, no new mechanism)

**Decision.** `contracts/field-replacement-pattern.md` documents it. It is a new field of the wanted
type (a slot field stored in a side table or D2 columns, or an operator custom field). The core field
is hidden if it is optional, or kept read-only and derived if it is required. The new field is
slotted `after` the core field. Its values are written through `extensions` and a hook. Optionally,
the core field is filled with a compatible projection: the form derives it, and the deployment's
hook refuses a write whose core value disagrees with the projection of the new value. Where several
deployments need the wider type, the core type changes, through the breaking-change rules.

**Rationale.** Changing a core field's type per deployment would fork the contract that migrations,
ports, search, exports and other modules rely on (XV). The pattern uses only the mechanisms above,
and the projection keeps core features working.

**Rejected.**
- *A `type` override.* It would fork the contract.
- *Writing the projection from the hook through `ctx.run` of the owner's Command.* The same action
  may not appear twice in one hook chain (176 `COMMAND_HOOK_CYCLE`). An `afterCommit` port write is
  possible, but it is eventual and produces a second audit entry. The guide names it as the fallback
  when the form cannot compute the projection.

## R-16: Which core forms first, what adoption costs, and what `../paid-modules` needs

**Findings.**

| Form | Host module | Hookable writers today | D2 / side-table read wire | One Save | Size of the JSX to adopt |
| --- | --- | --- | --- | --- | --- |
| Organization create and edit | `organizations` | `organization.create`, `organization.admin_patch`, `organization.set_custom_field_values` and three more | `?extensions=` (D2) on detail and list | yes (180 WP-7) | `OrganizationCreate.tsx` 12.9 KB; detail editable sections only |
| Project create and edit | `projects` | eight actions (`PROJECT_HOOKABLE_ACTIONS`) | none | partial | `ProjectCreate.tsx` 33.1 KB |
| Customer detail | `customers` / `customer_accounts` | **none** | none | yes | `CustomerDetail.tsx` 27.6 KB |
| Opportunity create and edit | `crm` | **none** | none | n/a | `OpportunityCreatePage.tsx` 17.3 KB |
| Product editor | `catalog` | **none** | none | yes (scope-aware) | `ProductEditor.tsx` 99.7 KB plus tabs; scoped values per channel and locale |

**Decision (proposed; the order is OQ-193-5).** The first release adopts organization create and
edit. The next release adopts project, then customer and opportunity, after their owners declare
hookable writers (FR-081). The product editor comes last. Its field set keeps the existing
`fieldPath` strings as keys: `name`, `description`, `categories`, `gallery`, `attachments`, and
`attributeValues.<key>` as a key family. Scoped values add a scope dimension to the projection,
which needs its own design pass.

**What adoption costs a core module, per form.**
1. A field-set and form declaration in contracts, plus manifest entries.
2. The form's fields rendered through `DeclaredFormSection`, with renderers keyed by field key. This
   is a render-path swap, and the behaviour must stay unchanged (SC-006).
3. Writer projections registered with `ctx.fieldSets`, plus `expectFieldSetMatchesSchemas` and
   `expectFieldSetWriters` in its tests.
4. The `extensions` body field on its admin create and update routes, and the `?extensions=` read
   wire (OQ-193-1 A).
5. Its keys becoming contract surface (R-2).

**`../paid-modules`, read-only.** Fifteen modules were read: `autopay`, `comarch_xl`, `dhl_parcel`,
`infakt`, `inpost`, `ksef`, `paypal`, `payu`, `pim_akeneo`, `pim_ergonode`, `pim_pimcore`,
`pim_unopim`, `stripe`, `tpay` and `wfirma`.
- None ships a field into a core form, and none would need form keys to keep working.
- Their zone contributions are to `payment_method.list.integrations` (5),
  `product.editor.details.before` (4), `product.editor.pricing.before` (4),
  `product.editor.field.after` (4), `delivery_method.list.integrations` (2),
  `order.shipments.tab.actions` (2), `ledger.section.tabs` (2), `order.shipment.row.actions` (1) and
  `invoice.detail.after` (1).
- The four PIM modules read `fieldPath` on `product.editor.field.after` and pass it to admin-kit's
  `FieldProtectionToggle`. FR-082 keeps those strings unchanged, so no paid module needs a change.
- The likely future consumer is a PIM module wanting synced product fields read-only. That would be
  a granted package override (OQ-193-2 A) once the product field set exists.

**No breaking change is needed.** The owner's ruling on #1983 prefers early breaks while adoption is
low, but only where a break is necessary. One break was considered: aligning the product keys with
write-model names (`categories` to `categoryIds`). It was rejected as unnecessary. The projection
maps keys to the write model, and renaming would break four external modules for a cosmetic gain.
Every contract change here is additive: an optional `extensions` body field, optional manifest
fields, new contribution arrays and new hookable actions.

## R-17: i18n

**Decision.** A slot field's label, help and errors come from the contributing module's bundle. An
override's `label`, `help`, `placeholder` and `message` keys come from the declaring module's bundle.
All of them are relative keys in flat `en` and `pl` bundles, and `registered-bundles-shape.test.ts`
covers them as manifest-declared keys. `FIELD_RULE_VIOLATION`, `FIELD_WRITE_FORBIDDEN` and
`FIELD_SLOT_INPUT_INVALID` are platform error codes declared by `_lifecycle` and translated under
`errors.<CODE>`. Their per-entry sentences (required, too long, not an option, invalid e-mail, and
so on) are worded by the backend in the request's language. This is case 1 of `module-i18n.md`: the
backend can resolve the reader's language, so it translates and ships the code beside the sentence.
Platform control labels come from the `core` bundle.

## R-18: Caching

**Decision.** The effective forms are a pure function of the composition, which is fixed for the
life of a process, and the effective presence. They are memoised per process, keyed by the presence
snapshot the lifecycle pub/sub already propagates to every process. There is no new Redis key and no
invalidation message. The admin fetches `GET /api/v1/admin/forms` with `/module-presence` and
refetches whenever presence refreshes, and the response carries an `ETag`.

**Rationale.** A second cache keyed on the same fact would be a second answer to one question
(D-100).

## R-19: Tenant scoping, Settings, palette, permissions, audit

- **Tenant scoping.** Overrides are deployment-wide, not per organization. They carry no tenant data,
  and the effective-forms response is the same for every admin. Slot data lives in side tables
  classified to follow their host (187 OR-9). A per-organization form variant was rejected, because
  presentation differing per tenant has no current case (IV).
- **Settings.** There is no setting. Overrides are code (OQ-193-6). A module that wants its slot to
  be operator-toggleable already has its activation control (XVII).
- **Command palette.** `_lifecycle` declares one action, "Form extensions", for
  `/platform/form-extensions`, gated by `platform.modules.read` (XVI). Slot fields add no routes.
- **Permissions.** There are no new codes. The descriptor route has no code, on
  `/module-presence`'s reasoning. Slot modules and overrides name codes their own manifests declare,
  or codes the platform vocabulary holds. Composition refuses a `writePermission` that names an
  unknown code (`unknown-permission`).
- **Audit.** Slot writes are noted in the host's single audit entry (176). A field-rule refusal
  writes nothing and audits nothing, as a refused `admit` does. Override declarations are code and
  are not writes.

## R-20: Mapping to Magento 2, Sylius and Medusa v2

| Requirement | Magento 2 | Sylius | Medusa v2 | This design |
| --- | --- | --- | --- | --- |
| Add a coded field to a core form (FR-010) | UI-component XML merged across modules, plus `DataProvider` modifiers: **replaced** | `FormTypeExtension::buildForm()->add()`: **replaced** | No equivalent (widgets only around forms): **deliberately exceeded** | Slot field anchored on a declared key |
| Order fields (FR-011) | `sortOrder` integers, last writer wins: **avoided** | Twig Hooks integer priorities: **avoided** | n/a | Relative anchors, `(weight, moduleId, key)` tie-break, ambiguity reported |
| Know the final form statically | Impossible (modifiers run at runtime): **avoided** | Partly (form type plus template): **avoided** | n/a | Declared field sets plus a build-time check |
| Persist the added value (FR-013, FR-014) | Extension attributes plus a plugin on the repository's `save`: **replaced** | Doctrine entity extension or trait plus migration: **avoided** (it changes core entities) | `additional_data` to workflow hooks: **adopted in spirit** | `extensions.<moduleId>` to a `beforeCommit` hook, written to the module's own side table |
| Hide a core field (FR-020) | `visible=false` in XML; the field still validates if required: **avoided** | `->remove()` in a form extension; the entity constraint still fires: **avoided** | Not possible | `hidden` only on optional fields, refused at boot otherwise |
| Relabel, help, placeholder | XML `label`/`notice` in any module: **replaced** | Translation override: **adopted** (bundles) | Not possible | Declared override with keys in the deployment's bundle |
| Swap the input control (FR-032) | `formElement` / `component` change in XML, unchecked: **replaced** | `->add('x', OtherType::class)`, unchecked: **replaced** | Not possible | Control registry with output types, fit checked at boot |
| Tighten validation (FR-022) | XML `validation` rules, client-side only unless duplicated in PHP: **avoided** | Validation groups and constraints on the entity: **adopted in spirit** (server) | Workflow hook validation: **adopted** | Tightening-only rules from one declaration, enforced in the Command |
| Conditional visibility and required-ness (FR-040) | `imports`/`exports`/`listens` JS links, client-only: **avoided** | JS in templates: **avoided** | n/a | One condition vocabulary, one evaluator for client and server |
| Any module may change any field | Yes: **avoided** | Yes, via form extensions: **avoided** | n/a | Owner's `accepts`; deployment tier; packages by grant only |
| Change a core field's type | Plugins plus EAV backend-type change: **avoided** | Override the entity mapping: **avoided** | Not possible | Replacement pattern; core change for shared needs |
| Per-deployment full screen replacement | Layout override of the whole form: **kept available** (190) | Template override: **kept available** | Custom route: **kept available** | Overlay admin layer (190) stays the escape hatch, at the cost of re-doing every core change |
