# Research — Admin form extensions (193)

Architect rulings R-1 to R-24 (R-22 also carries D-300.8, and R-24 carries D-300.9 to D-300.16,
the phase 2 architect rulings). Each one gives the decision, the reasons for it, and the
alternatives that were rejected. On 2026-11-27 the owner answered OQ-193-1 to OQ-193-6; the answers
are recorded as **D-300** in `spec.md`. R-21 to R-23 design what D-300.5 and D-300.6 require.

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

## R-6: Reading slot values (D-300.1, as recommended)

**Ruled A.** A side-table loader opts into admin reads (`adminReads: true`),
and the adopting host's admin detail route serves the value on `?extensions=<moduleId>`
(`ExtensionsQuerySchema`, already used by `organizations` for D2). 187 R-17 recorded the
implementation, the collision rule and the estimated cost (one module may not serve both D2 columns
and a loader under one key on one host), and its rationale for deferral was that no admin consumer
existed. This feature is that consumer. The ruling belongs to the owner because it reopens OR-10.

## R-7: Overrides are manifest data, enforced by the server and served to the admin

**Decision.** A deployment's overlay module declares `formOverrides` in its manifest. The
declaration is pure data. Composition validates it (FR-021). The server enforces its rules (R-9),
and `GET /api/v1/admin/effective-forms` serves the effective presentation to the admin. Code-bearing behaviour,
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
- *A runtime Settings source* for the deployment layer. D-300.6 adds an operator layer for presentation only (R-21). The code shape is kept pure data so that a source of this
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

**Constitution.** The check is a declared refusal inside a declared hookable action, and it writes
nothing, as XIII's middleware sentence requires of `admit`. On the owner's instruction (D-300.7),
XV is amended (4.6.0, drafted on top of #2010's 4.5.0, approved by the owner on 2026-11-27, merged
in #2007). The amendment adds
"declared form extensions" to the bounded surface, and adds one bullet stating what a deployment may
and may not adjust on a core form, and that operator overrides are presentation only.

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

**API-key actors (T-B6, recorded by WP-B, T026).** No resolution exists. `CommandActor` carries no
API-key id and no scopes; the key's scopes live on `request.actor`, which `auth` decorates and no
code inside a Command can reach (the tenant context keeps only `{ kind: 'api_key', id }`, and the
Command Bus maps it to an actor with neither). So:

- A **bound** key (actor kind `api_key`) that changes a field with an effective `writePermission`
  is refused `403 FIELD_WRITE_FORBIDDEN`, with `details[].reason: 'api-key-scopes-unresolved'`
  (`FIELD_WRITE_FORBIDDEN_REASONS` in `@endora-commerce/contracts`). The refusal fails closed; a
  write that leaves the field unchanged is not affected.
- An **unbound** key acts in the system scope (feature 062, FR-020), so the Command sees a
  `system` actor, which is exempt as every system actor is. The platform cannot tell it apart
  from a worker.
- The tightened rules themselves (`validation`, `requiredWhen`, formats) bind every API-key write;
  only the permission question is unresolved.

Lifting the refusal needs the key's scopes on the Command's actor (or a request-scoped accessor
the check may read), which is a change to `auth`, the tenant context and `CommandActor`, outside
this feature.

## R-13: Trust tiers (D-300.2 rules the package row: A, grant only)

**Decision.** The capability table, using 189 `contracts/module-origin.md`'s words:

| Capability | core | deployment | package |
| --- | --- | --- | --- |
| slot fields on another module's field set | yes, by the field set's invitation | yes | yes |
| `formOverrides` on its **own** field set | not applicable (it edits its own declaration) | yes | yes |
| `formOverrides` on another module's field set | **no** (`foreign-override`) | yes, within `accepts` | only under a `formOverrideGrants` entry (D-300.2) |
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

**Decision (D-300.5 = C, overriding the recommended A).** All five hosts adopt in one release.
Inside the release they are sequenced by dependency. Organizations goes first and proves the
mechanism. Projects needs only adoption. Then `customer_accounts`, `crm` and `catalog` declare their
hookable writers (R-22), and customer and opportunity adopt after that. The product editor adopts
last, section by section (R-23). Its field set keeps the existing `fieldPath` strings as keys:
`name`, `description`, `categories`, `gallery`, `attachments`, and the key family
`attributeValues.<key>`.

**What adoption costs a core module, per form.**
1. A field-set and form declaration in contracts, plus manifest entries.
2. The form's fields rendered through `DeclaredFormSection`, with renderers keyed by field key. This
   is a render-path swap, and the behaviour must stay unchanged (SC-006).
3. Writer projections registered with `ctx.fieldSets`, plus `expectFieldSetMatchesSchemas` and
   `expectFieldSetWriters` in its tests.
4. The `extensions` body field on its admin create and update routes, and the `?extensions=` read
   wire (D-300.1).
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
  a granted package override (D-300.2) once the product field set exists.

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

## R-18: Caching (revised for D-300.6)

**Decision.** The effective forms are computed from three inputs: the composition, which is fixed
for a process; the effective presence; and the operator layer, which is data. Each process keeps one
memo, keyed by the presence snapshot and an operator-layer generation counter.

- **Presence** reaches every process through the existing lifecycle pub/sub
  (`b2b:module:state-changed`).
- **The operator layer** is a small table, at most one row per form and field. Each process loads
  it whole into an in-process cache. After its Command commits, `custom_fields` announces
  `b2b:form-layout:changed`. Every process then bumps the generation and drops the cache, the same
  way `SalesChannelAccessCache` publishes after a write (D-93). A process whose subscription is lost
  is stale for at most the cache's 60-second TTL and never serves a wrong rule. No server-enforced
  rule comes from this layer, so a stale entry is a presentation lag only.
- **No shared Redis layer.** The table is read whole in one query, so a second shared copy would buy
  nothing (IV).
- The admin refetches `GET /api/v1/admin/effective-forms` when presence refreshes and after its own layout
  write. The response carries an `ETag`, which is a digest of the response.

**Rationale.** Presence already has an invalidation channel, and the operator layer gets the
existing write-then-announce pattern. Neither gets a second cache keyed on the same fact (D-100).

## R-19: Tenant scoping, Settings, palette, permissions, audit

- **Tenant scoping.** Overrides are deployment-wide, not per organization. They carry no tenant data,
  and the effective-forms response is the same for every admin. Slot data lives in side tables
  classified to follow their host (187 OR-9). A per-organization form variant was rejected, because
  presentation differing per tenant has no current case (IV).
- **Settings.** D-300.6 adds the operator layer (R-21). It is a table, not the settings store.
  Deployment overrides remain code.
- **Command palette.** `_lifecycle` declares one action, "Form extensions", for
  `/platform/form-extensions`, gated by `platform.modules.read`. `custom_fields` declares one
  action, "Form layout", for `/custom-fields/forms`, gated by `custom_fields:read` (XVI). Slot fields
  add no routes.
- **Permissions.** There is one new code, `custom_fields:forms` (R-21). The descriptor route has no code, on
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

## R-21: The operator layout layer (D-300.6)

**Scope: the presentation kinds a business operator may set.** These are `label`, `help`,
`placeholder`, `position` (section, before or after), `hidden` and `readOnly`. Each one is limited to
what the field's `accepts` lists. A core-required field can never be hidden, and nothing may be made
unfillable (`required-not-fillable`). Tightened validation, `requiredWhen`, `control`, `default`,
`writePermission`, masks and derivations stay deployment code. Each of these either changes what the
API accepts, which XV reserves to the deployment, or is code.

- **`readOnly` is included.** It is presentation in the same sense as a custom field's admin access
  level `read`, which operators already set (175, OD-8). The screen states that the setting does not
  restrict the API, and links to permissions for real protection.
- **`default` is excluded.** It is not unsafe, but a per-type value editor with type checks is not
  worth its cost for a pre-fill (IV). It can be added later because the shape is open.

**Owner and storage.** The layer belongs to `custom_fields`. Its table is
`custom_field_form_layout_overrides`, platform-global (`@GlobalEntity`, like
`custom_field_definitions`). Each row holds `id`, `form_id`, `field_key`, `labels jsonb`,
`helps jsonb`, `placeholders jsonb`, `section`, `before`, `after`, `hidden`, `read_only`, `version`
and `updated_at`, with a unique key on (`form_id`, `field_key`).

- **Why `custom_fields`.** An operator thinks of "fields" as one subject, and `custom_fields` already
  owns the operator's field-definition screen and the per-locale label design (XIV: reuse the
  design). It is also non-deactivatable, so the layer cannot be switched off with its owner while
  forms still depend on it. That removes an off-state case instead of handling it.
- **Rejected: the settings store.** Settings are manifest-declared scalar codes, scoped per channel.
  One JSON blob per form would mean one concurrency token and one coarse audit diff for every field
  on the form, and an undo per blob.
- **Rejected: a new module.** It would split one operator subject across two screens and two
  activation controls, with no domain boundary between them.
- **Rejected: `_lifecycle`.** That is platform surface (D-160.11), and the layer is business data.

**Composition.** The platform declares the port `FormLayoutOverrideSource` in contracts
(`Container name: formLayoutOverrideSource`), and `custom_fields` provides it. `FormRegistry`
resolves it lazily when computing the effective forms. Because `custom_fields` is non-deactivatable,
the port is always present. If the port is nonetheless missing in a composition, the layer is empty
and the forms fail open to code and core, which only affects presentation.

**Precedence.** For each field and kind: core < deployment code (and granted packages) < operator,
for `label`, `help`, `placeholder` and `position`. The operator is the business owner of how the
form reads, and deployment code sets the default. `hidden` and `readOnly` are monotone: an operator
may add them but not remove what code set. Code may hide a field as part of the replacement pattern,
and an operator who unhid it would get two fields for one value.

- **What the screen shows.** It shows each layer with its source module, and offers *Reset to
  deployment value* or *Reset to core* depending on which layer is underneath.
- **Rejected: code always wins.** That makes the business ask a developer to change a label the
  deployment once set.
- **Rejected: a `lockedForOperators` flag on code overrides.** No case needs it (IV).

**Validation.** The same `FormRegistry` rules apply on write: `override-not-accepted`,
`hidden-required-field`, `required-not-fillable`, `unknown-field` and `unknown-section`. They run
inside the Command, and a refusal answers `422 FORM_LAYOUT_OVERRIDE_INVALID` with
`details[].code`. Positions are validated against the form after code overrides. If code later moves
the anchor field away, the operator position falls back to the code position, and the screen shows a
notice.

**i18n.** Each text is a map with an entry for every language in `SUPPORTED_LANGUAGES` (`en` and
`pl`), and all entries are required. This is operator content (`module-i18n.md`: per-language columns,
never a bundle), served by the effective-forms response as
`{ source: 'operator', text: { en, pl } }`, and the admin picks the reader's language. A language
added later has no entry, so the field uses the code or core label in that language rather than
another language's text. This is the rule a setting description already follows (issue #1522).

**Commands and audit.**

- `custom_fields.form_layout.set` takes one form and a batch of field rows, under per-row `version`
  optimistic concurrency.
- `custom_fields.form_layout.reset` takes one form and some or all of its keys.
- `custom_fields.form_layout.rekey` is the system Command of FR-099.
- `set` and `reset` are reversible: the pre-state is captured per row, and undo is all-or-nothing per
  row with a conflict report (XIII). The audit state is the row before and after. Label text is
  operator content and not personal data, so it is recorded.
- After commit, the Command announces `b2b:form-layout:changed` (R-18).

**Off-state.** When a field set's owner, or the rendering module of a form, is not effectively
present, its rows are ignored and kept, and the screen lists them as belonging to a switched-off
module. Switching the module back on restores them. An override that targets a slot field of an
absent module behaves the same way.

**Renamed keys.** During a deprecation release, a row on an alias is rewritten to the live key at
boot. This is idempotent, uses one system Command per affected form, and is audited. A row whose
alias the owner removed before any boot rewrote it becomes `orphaned`: it is ignored by the effective
forms, shown in the screen and deletable there. A row holding a kind the field no longer accepts is
`no-longer-accepted` and is treated the same way. Rewriting at read time instead was rejected,
because it would keep the alias alive in data after the code had dropped it.

**Permissions and palette.** The new code is `custom_fields:forms`, "Manage form layout". The routes
are `GET /api/v1/admin/custom-fields/forms` and `GET /api/v1/admin/custom-fields/forms/:formId`
(gated by `custom_fields:read`), and `PUT /api/v1/admin/custom-fields/forms/:formId` and
`POST /api/v1/admin/custom-fields/forms/:formId/reset` (gated by `custom_fields:forms`). The palette
action "Form layout" targets `/custom-fields/forms` and is gated by `custom_fields:read`.
`check:action-route-permissions` and the permission inventory cover all of them.

## R-22: Hookable writers for `customer_accounts`, `crm` and `catalog` (D-300.5)

Measured actions:

| Host | Commands that write the field set | Declared hookable here | Notes |
| --- | --- | --- | --- |
| `customer_account` | `customer_account.create`, `customer_account.update_profile`, `customer.custom_fields.update` | all three, both phases | the `customers` screen writes through `customer_accounts`' port (feature 075) |
| `opportunity` | `crm.opportunity.create`, `crm.opportunity.update` | both | the custom-field port runs `crm.opportunity.update` |
| `product` | `product.create`, `product.update`, `product.scoped_values.save`, `product.scoped_values.import` | all four | scoped hook data is per scope (FR-112) |
| `product` | `product.bulk_update.item`, one per product of a bulk edit (inline and queued) | **no**; rule-check-only writer (FR-113, D-300.8) | the queued run is reversible, and 176 §6 forbids hooks on a reversed write. `product.bulk_update` itself is a summary audit row, not a Command |

**The rule-check-only writer.** The field-rule check writes nothing, so it does not break undo, which
is the reason 176 keeps hooks off reversible Commands. It can therefore run on a reversible Command,
and only it can. This holds because its registration path (`ctx.fieldSets`) is the platform's own and
is not `ctx.commandHooks`. Undo restores the previous values and is not a writer, so a rule added
after a bulk edit cannot block undoing it.

Each Command named in the table must be verified as non-reversible before it is declared hookable
(tasks T002, T006, T008). A Command found to be reversible becomes rule-check-only instead.

Hook data follows 176 §6 and audit-state list 1 for the outbox. The `beforeCommit` data may carry the
after-state record, as `OrganizationUpdateHookData` does.

### The bulk edit (D-300.8)

**What WP-H3 found.** The table originally listed `product.bulk_update` as a reversible Command.
That was wrong. Measured on WP-H3 (`753b15f16`):
- `product.bulk_update` is a summary row that `CatalogBulkUpdateService.recordSummaryAudit` writes
  straight to the audit port (`packages/modules/catalog/src/backend/services/catalog-bulk-update.service.ts`).
  It is not a Command.
- The field writes are one `product.update` Command per product, through
  `CatalogAdminService.updateProductAudited`. The queued run (`BulkOperationService`, above
  `BULK_ASYNC_THRESHOLD`) wraps them in a revert snapshot, so once `product.update` is hookable, a
  hook fires on every product of a reversible edit.
- The undo is **one** Command, `product.bulk_update.undo` (`objectType: 'bulk_operation'`). It
  restores columns with `em.assign` and scope rows with `restoreScopedStatus`
  (`bulk-operation.service.ts`, `#undoCommand`). It runs no `product.update`, so a hook never sees
  the revert. After commit it emits `product.updated.v1` for each restored product.
- The bus picks hooks by `command.action` alone (`packages/platform/src/commands/command-bus.ts`,
  `execute` and `runBeforeCommitHooks`). A run has no way to opt out.

So the guarantee in 176 §6 was being broken. A `beforeCommit` hook's side rows stayed behind after an
undo, and so did the external effect of an `afterCommit` handler. None of this reached a test,
because the undo never runs a hookable action.

**Decision.** Each product write of a bulk edit runs under its own action,
`product.bulk_update.item`. The action has the same `run`, audit state, event and `hookData` as
`product.update`, and no `outboxData`. It is never declared hookable and is registered as a
rule-check-only writer. This holds on the inline path and the queued one, and whichever fields the
edit touches. The undo is unchanged.

**Rationale.**
- *No new mechanism.* The rule-check-only writer already exists in this design (FR-113, field-rules
  §2/§5), and so does the composition refusal of hooks on an undeclared action. The change is one
  action string chosen by the caller and one service method.
- *176 §6 holds by construction.* No action that a reversible run executes can carry a module
  hook, so an undo cannot leave hook state behind. The field-rule check still binds bulk edits
  (D-300.3), and because it writes nothing, undo stays honest.
- *One rule a hook author can state.* "`product.update` hooks never see bulk edits" is predictable.
  Splitting by reversibility, with hooks on the inline path (≤ `BULK_ASYNC_THRESHOLD`) or on
  non-revertible fields and none on a queued revertible run, would make the hook's coverage depend on
  selection size. A test with 20 products would pass, and production with 500 would behave
  differently. A veto would therefore not be an invariant on either variant, and the narrow variant
  hides that.
- *A symmetric observation channel already exists.* `product.updated.v1` is emitted by every
  forward product write and by the undo for every restored product. A hook only ever sees the
  forward half.
- *Audit history improves rather than degrades.* `RecordHistory`
  (`packages/admin-kit/src/components/record-history/RecordHistory.tsx`) reads entries by object,
  not by action, so a product's history still lists the write, labelled as a bulk edit. Recent
  Activity lists `product.update` and `product.bulk_update` (`catalog/src/manifest.ts`
  `recentActivity`). Per-product bulk rows stop flooding the card, and the summary row stands for
  the run, as it was meant to. No reader in this repository or in `../paid-modules` filters on the
  `product.update` string for anything other than a label or that card.

**Costs accepted.**
- From this release, an audit-log query for `--action=product.update` no longer returns per-product
  bulk writes. Rows written before the release keep `product.update`, so they are not rewritten.
  This is called out in the catalog changeset.
- A `beforeCommit` veto on `product.update` does not bind bulk edits. That was already true of every
  reversible write under 176, and the field rule is the instrument that does bind them.

**Rejected.**
- *(A) Accept hooks inside a bulk edit and let the undo be "another edit".* This rests on a false
  premise: the undo writes no `product.update`. Routing the undo through per-product `product.update`
  children would make every hook a potential refusal of the undo. A tightened `required` on a
  cleared field would refuse a revert to the old empty value (D-300.4). Because a child failure rolls
  back the whole undo Command, the per-record conflict reporting (054 FR-006/FR-007) would turn into
  all-or-nothing. It also only makes hook state "follow" for hooks that are pure functions of
  product state. That is not a property 176 asks of a hook, and nothing can check it.
- *(C) A platform rule-check-only run mode for a hookable action.* It changes the bus at its
  hottest point (`execute`). It is also a per-run hook bypass, so the field-rule check would be the
  only thing holding it to its purpose, and any owner could set it on any run. A separate action
  gives the same effect, and the composition refusal already holds it.
- *(D) `product.bulk_update` as a parent Command with per-product children, and hooks gated by
  lineage.* A parent Command is one transaction. The queued run deliberately commits each product
  on its own (no batch abort, progress counters, thousands of products). Gating by lineage is also a
  platform change, to `Lineage` and hook selection, made for a single caller.
- *(E) Keep the hooks, and mark the operation not reversible whenever a present module hooks
  `product.update`.* Every deployment with a product slot field registers such a hook (FR-112,
  `fieldSlotHook`), so 193's main use case would switch off 054's undo. Exempting slot hooks would
  mean a new hook classification on the bus.

**Guard against recurrence.** A test asserts that a bulk run, both inline and queued, executes no
action from `PRODUCT_HOOKABLE_ACTIONS`. A product write that a later feature adds to the bulk edit
then fails that test until it is given a non-hookable action, which covers, for example, archive or
restore being declared hookable in the future.

## R-23: How the product editor adopts without a big-bang rewrite

**Constraints.**
- `ProductEditor.tsx` is 99.7 KB.
- Fields are scope-aware: `EditorField` handles the view, inheritance and `globalOnly` across
  global, channel and locale scope.
- There are twelve `product.editor.field.after` mounts, read by four external modules.
- The editor already runs one scope-aware Save (180).

**Strategy: a strangler, section by section.**

1. **Declare first, change nothing (MR 1).** Add `PRODUCT_FIELD_SET` and `product.edit` to
   contracts, the manifest and `ctx.fieldSets`, covering the writers and the scoped projection. No
   render change yet. Its tests are `expectFieldSetMatchesSchemas` and `expectFieldSetWriters`, plus
   the pre-adoption accessible-structure snapshots at three scopes (FR-125), which are recorded now.
2. **Wrap, don't replace (MR 2 to MR 6, one per section).** Adopt in this order: *Content* (`name`,
   `urlKey`, `description`), *Availability*, *Identity*, *Categories*, *Media* (`gallery`,
   `attachments`). Each `DeclaredFormSection` renderer returns the existing `EditorField` unchanged,
   with its `note={<AdminZone name="product.editor.field.after" …/>}`. The kit supplies only the label,
   help, placeholder, order, visibility and slots around it.
   `EditorField` gains optional `label`, `help` and `readOnly` inputs from the kit, so the scope
   logic stays in `catalog`.
3. **Attributes last (MR 7).** The `attributeValues.*` family is rendered by
   `ProductAttributesTab.tsx` from attribute data. Overrides and anchors name a family member, which
   is validated at render time (FR-123).
4. **Untouched.** Pricing, SEO, channels and content-editor zones stay as they are. They are tabs
   and zones, not fields.

**Tests, after every MR.**
- The three-scope accessible-structure snapshot matches (FR-125).
- `batch-fifteen-surfaces.module-owned-surface.test.tsx` mount counts are unchanged (FR-122).
- The existing catalog editor tests pass unedited.
- The four PIM admin layers typecheck and build against the built packages (FR-126).
- The 4-path parity test (SC-002) passes for `product.update` and `product.scoped_values.save`.
- Off-state: with the fixture overlay off, the editor matches the snapshot.

**Sequencing inside the release.** The catalog hookable actions (R-22) land first. The product
adoption starts after organizations has merged, so the kit primitives it wraps are already proven
on a smaller host. The product MRs run in parallel with the customer and opportunity adoptions,
because they touch disjoint files.

**Risks.**
- *The scope interplay is subtler than wrapping.* Overrides at the editor level are presentation and
  apply at all scopes. Rules apply per scope (FR-124). Nothing changes inheritance.
- *A PIM contributor depends on DOM position.* The mounts stay inside the same `EditorField` `note`
  slot, so their position does not move.
- *The release slips because of the product editor.* Every MR leaves the editor shippable, so the
  release can stop after any section with a partly adopted editor. The unadopted sections simply
  accept no overrides, and the spec calls this out as the cut line rather than as a defect.

## R-24: Phase 2 rulings (D-300.9 to D-300.16, architect rulings, 2026-11-27)

WP-B (platform, `packages/platform/src/kernel/forms/`) and WP-D (CLI and check,
`packages/cli/src/lib/admin-forms.ts`, `backend/scripts/check-admin-forms.ts`) raised eight points
before their merge requests opened. Each ruling below prefers the least machinery. None changes an
owner answer. R-24.3 extends D-300.4's reasoning and was accepted
(owner, 2026-11-27; recorded on #2026).

### R-24.1: The effective-forms path (D-300.9)

**Decision.** `GET /api/v1/admin/effective-forms`, registered by `_lifecycle` beside
`/api/v1/admin/module-presence`.

**Rationale.** `/api/v1/admin/forms` and `/api/v1/admin/forms/:id` belong to the `forms` module
(`packages/modules/forms/src/backend/routes/routes.forms.ts`). `_lifecycle`'s own admin paths are
flat nouns (`module-presence`, `command-hooks`, `command-outbox`), and `effective-forms` is one too.
It names what the response is: the forms after every layer, not the declarations.

**Rejected.**
- *`/api/v1/admin/forms/effective`.* It sits in another module's namespace, next to that module's
  `/:id`. It reads as a form called `effective`, and it would still be served while `forms` is
  switched off.
- *`/api/v1/admin/module-presence/forms`.* It couples two responses with different caches and
  ETags.
- *`/api/v1/admin/form-extensions`.* That is the name of the read-only screen (FR-072), which may
  need a read of its own.

### R-24.2: Telling a buyer's anonymous write from a system write (D-300.10)

**Measured.** No anonymous actor kind exists, by design
(`packages/platform/src/tenancy/resolve-tenant-context.ts`, "There is no anonymous kind"). An
unauthenticated request gets `systemTenantContext('actor:none')` from
`packages/platform/src/kernel/actor-tenant-context.ts`, and `actorFromContext`
(`packages/platform/src/commands/actor.ts`) maps it to `kind: 'system'`. That is the same actor as a
worker's. `organization.register`, the standalone registration
(`customer-account-register-standalone.command.ts`) and the invitation acceptance run that way.
`organization.register` runs `customer_account.create` as a child through `ctx.run`, on the same
actor. WP-B skips only `kind: 'customer'` with no admin, so a deployment that tightens a
`customer_account` or `organization` field would refuse storefront registration. That contradicts
D-300.3 and T042 ("`register` is listed and skipped for buyer actors").

**Decision.** `Command` gains an optional `buyerSelfService?: true`. The Command Bus carries it in
the lineage it already keeps for child Commands (`Lineage.ancestors` in `command-bus.ts`), so a child
inherits it from any ancestor. It reaches the field-rule check as
`FieldRuleCheckContext.buyerSelfService: boolean`. The check skips a write when the actor is a
customer acting for itself, or when the flag is set and the actor has no acting admin and is
`system` or `customer`. The flag is ignored on `admin` and `api_key` actors and under
impersonation, so setting it on an operator path cannot exempt that path. Without the flag a
`system` actor stays bound. The storefront roots that run a field-set writer anonymously set it.
`organization.register` sets it in WP-E1, and `customer_account.register_standalone` sets it in
WP-E3. The invitation acceptance (`invitation-service.ts` in `organizations`) is a root
`customer_account.create` run through `CustomerAccountMemberWritePort.create`, the same port the
admin member create uses. That port's input therefore gains an optional `buyerSelfService?: true`,
which it puts on the Command (WP-E3). `organizations` passes it from the acceptance only (WP-E1).
WP-E3 also adds a test listing every storefront route that reaches a field-set writer, so that a
new one cannot go unmarked.

**Rationale.** The Command that the storefront route runs is the one place that knows it is a
buyer's write, and it is server code. One optional member on a published interface is additive.
Children inherit it from the lineage the bus already threads, so `customer_accounts` never names
`organizations`' action.

**Rejected.**
- *Infer it from the tenant context's `reason === 'actor:none'`.* The reason is a free-text audit
  string, and every unauthenticated route has it, including payment and integration callbacks. A
  PIM webhook writing products would then escape rules that D-300.3 says bind it.
- *A new `anonymous` actor kind.* Tenancy refuses one on purpose. It would change the audit
  columns, every `kind` switch and the tenant guard, all for one check.
- *A per-writer `selfService` flag in `ctx.fieldSets`.* `customer_account.create` is written by the
  admin member create (bound) and the registration child (not bound). One action cannot carry both
  answers.
- *Keep WP-B's fail-closed behaviour.* It refuses a buyer's registration because of an
  operator-side rule, which is the exact case D-300.3 excludes.

**Amended (D-300.31, R-26.6).** The flag is set per call by the caller that knows it is a buyer,
not by the Command type: the storefront registration is a `createStandalone` call, so
`createStandalone`'s options carry `buyerSelfService?: true`, as
`CustomerAccountMemberWritePort.create`'s input does.

### R-24.3: Non-retroactivity covers every rule kind (D-300.11)

**Decision.** WP-B's reading is confirmed. On an update the check holds a field only when the write
changed or cleared it, for bounds, `options`, `pattern` and `format` as for `required`. One
correction: `requiredWhen` is also held when the write changed a field its condition reads. A
create holds every field. The admin form holds the same set (`field-rules.md` §6).

**Rationale.** D-300.4 keeps a rule added after the data from making existing records uneditable.
The literal §5 step 4 would do exactly that for every other kind. Suppose a deployment adds
`maxLength: 50` to a name and an organization has a 60-character name. That organization could not
have its phone changed until someone shortened the name, and a bulk edit
(`product.bulk_update.item`) would fail on rows it did not touch. Every value a write sets still
satisfies the rule, which is what D-300.3's "binds every write" needs. The `requiredWhen` correction
closes a hole in WP-B's version. A write that switches `country` to a value that makes `vatId`
required, while leaving `vatId` empty, is the write that creates the violation, so it has to be held.

**Rejected.**
- *The literal step 4 (check every present value of `after`).* It is retroactive in all but name.
- *`requiredWhen` held only when the target changed (WP-B as built).* That lets a write create a
  violation it never has to answer for.

**Owner decision.** This extends the owner's D-300.4 from `required` to every kind. Accepted
(owner, 2026-11-27; recorded on #2026).

### R-24.4: Where `required-not-fillable`'s derivation exemption lives (D-300.12)

**Measured.** The exemption depends on `fieldBehaviours`, which only the admin layer has. The admin
layer's data half (`AdminFieldBehaviourSchema` in `packages/contracts/src/admin-forms.ts`) carries
`target` and `forms` only. Whether the lazy factory exports a `mask` or a `derive` is not readable
without evaluating it. `field-slots.md` §3 also left hidden and read-only fields out of the
submission. With that rule even a real derivation could not fill a required create field, which
breaks the replacement pattern (`field-replacement-pattern.md` §2 step 3).

**Decision.** Split the refusal by instrument, with no data flag.
- Composition (WP-B) refuses `hidden` on a field that is effectively required on a create form,
  with no exemption. A hidden field is never submitted, derived or not.
- `check:admin-forms` (WP-D) refuses `readOnly` there unless a `fieldBehaviours` entry of the module
  that sets `readOnly` targets the field on that form. A mask on a read-only field does nothing, so
  such an entry is a derivation in practice.
- The admin kit (WP-C) submits a read-only, visible field that a present derivation targets, with
  its derived value.
- The operator layer (WP-L1) refuses both kinds on such a field with no exemption, because it
  cannot see a derivation.

**Rationale.** Each instrument refuses what it can see, and nothing is declared twice. The check
already reads manifests (core required-ness, tightened `required`, `readOnly` overrides) and the
admin registries (`fieldBehaviours`). The remaining gap is a behaviour entry that is a mask on a
read-only required field. The server's required refusal answers it on the first create, so it is
visible, not silent.

**Rejected.**
- *A data flag on the override (`derived: true`).* The server would trust a claim it cannot verify,
  and the check would still need to verify it. That is two declarations of one fact.
- *Move the whole refusal, `hidden` included, into the check.* Composition can refuse `hidden`
  without the admin layer. Moving that half out would weaken the stronger instrument for nothing.

### R-24.5: Required `ModuleContext` members (D-300.13)

**Decision.** `fieldSets` and `fieldFormats` stay required. The platform changeset is `minor` and
carries a **Breaking change** paragraph worded as #1835's (`.changeset/1835-platform-entity-extension-reads.md`).

**Rationale.** `entityExtensionLoaders` set the precedent, and the owner prefers making breaks early
while adoption is low. The break reaches only a hand-written `ModuleContext` double, and there is
none in this repository or in `../paid-modules`. `major` is refused in `0.x`
(`specs/conventions/release-intent.md`).

**Rejected.** *Optional members.* Every caller would write `ctx.fieldSets?.(…)`, which silently
skips a registration where the method is absent. That is the silent partial write that
`CommandContext.run`'s comment refuses.

### R-24.6: One layout implementation (D-300.14)

**Measured.** The algorithm exists twice already, and WP-C would add a third. WP-D has `formLayout`
in the CLI. WP-B's `effective-forms.ts` has its own `move()` for step 1, and its ordering differs:
it applies operator moves after code moves rather than per key, and it sorts with `localeCompare`.

**Decision.** `formLayout` and its input and output types move to
`packages/contracts/src/admin-forms.ts`, beside `evaluateFieldCondition`. Step 1 is exported on its
own as `applyFieldMoves`. The CLI imports it, `effective-forms.ts` replaces `move()` with it, and
the kit calls `formLayout` with the server's order and no moves. The effective move of a key is the
operator's when one is set, else the code override's (two code moves on one key are already
`override-conflict`). An operator move sorts as module `custom_fields`. Every comparison is by code
point. `FORM_LAYOUT_VECTORS` is run by the contracts' own test. The CLI keeps its
shuffled-registration test over the analysis.

**Rationale.** The function is pure (no `node:` or `typescript` import) and is the normative
algorithm. Contracts is where the shared evaluator already lives, so all three readers get the same
answer by construction, not by vectors.

**Rejected.** *Two or three copies held against `FORM_LAYOUT_VECTORS`.* Vectors only find the drift
they enumerate. The two copies that exist already disagree on a case the vectors do not cover.

### R-24.7: `check:admin-forms`' readings of `field-slots.md` §6 (D-300.15)

**Decision.**
- (a) `position-anchor-mismatch`, meaning a field anchor with `start`/`end` or a section anchor with
  `before`/`after`, is ratified.
- (b) `unknown-anchor` is ratified. It also fires for an anchor the field set declares but a target
  form does not show, and for a cycle of own-slot anchors, whose finding must name every slot in the
  cycle. A family member counts as shown where the form shows the family.
- (c) `duplicate-slot-key` firing only on overlapping forms is ratified, with one condition. Two
  contributions of one key on disjoint forms must agree on `type` and `writePermission`, because
  they share one wire key, one hook schema and one write gate. Otherwise the finding fires.

**Rationale.** In (b) a slot whose anchor is absent from a form renders nowhere on that form, which
is the failure the code exists for. A cycle is the same failure with no absent key. A new code
would add nothing beyond the message. For (c), a module legitimately anchors one field differently
on a create form and an edit form whose sections differ. Disagreeing types under one key are not
legitimate.

**Rejected.** *A separate `slot-anchor-cycle` code*, which would be one more code for the same
remedy. *`duplicate-slot-key` regardless of forms*, which forces one anchor across forms that do not
share keys.

### R-24.8: Issue #2020 (D-300.16)

**Decision.**
1. `inputControlIdRe` gains `_?`, so it agrees with `moduleIdRe` and `moduleFieldFormatRe`.
2. The `defineFieldSet` comment stops claiming that a form naming an unknown key is a type error.
3. The declaration-level refusals the spec did not list (an override that sets no kind, an empty
   `in`, an empty `all`/`any`) are kept and are now listed in `field-overrides.md` §1.
   `minLength > maxLength` is not refused at declaration. Composition's `override-contradiction`
   judges satisfiability once, over every module's conjunction, and a lone override's contradiction
   is that conjunction's one-module case (`contradictionOf` in WP-B's `rules.ts`).
4. `formOverrideGrants[].reason` is capped at 280, the same as `FieldOverride.reason`.
5. The CLI reader of `formOverrideGrants` is done in WP-D (`divergence-artefacts.ts`).

Items 1, 2 and 4 go into WP-D's merge request, which already changes `@endora-commerce/contracts`
and carries its changeset. None of them is breaking: item 1 widens an input, and item 4 tightens a
field that no release has shipped yet (WP-A, #2018, merged after 0.112.0).

**Rejected.** *A separate contracts PR now.* It would mean a third PR and a third changeset on the
file WP-D is already amending, for three lines.

## R-25: Phase 3 rulings (D-300.17 to D-300.25, architect rulings, 2026-11-28)

WP-C (admin kit, `packages/admin-kit/src/lib/forms/`, `components/declared-form/`,
`components/controls/`, PR #2032) raised five points, and WP-B2 (admin reads,
`packages/platform/src/kernel/schema-extensions/reads.ts`,
`kernel/entity-extensions/registry.ts`) raised four. Each ruling below prefers the least
machinery. None changes an owner answer.

### R-25.1: Operator rows on slot keys (D-300.17)

**Measured.** FR-091 and `operator-form-layout.md` §1 and §2 admit operator rows on slot keys
(`label`, `help`, `position`, `hidden`), and R-21 § *Off-state* says how they behave when the slot's
module is off. `effective-forms.ts` serves core fields only, and its header says that an operator
row on a slot key "is the kit's to apply". The kit, though, receives nothing but
`EffectiveFormsResponse`, so no WP has a path for those rows. The server does not know which slots
exist, because slots are admin contributions (R-3). Two more facts constrain the design:
`formLayout` (`packages/contracts/src/admin-forms.ts`) applies `hidden` to core keys only, and
filtering a hidden slot out of its input would also drop the own-module slots anchored on it.

**Decision.** Slot overrides stay in scope. The response carries the rows, and the kit applies them.
- `EffectiveFormsResponseSchema.forms[]` gains `slots?: EffectiveSlotOverride[]`, where absent
  means none. Each entry is `{ key, label?, help?, position?, hidden, operatorKinds }`. `key` is the
  wire key `<moduleId>.<localKey>`. `label` and `help` are `EffectiveText` with
  `source: 'operator'`. `position` is `{ section?, before?, after? }`. Slots have no code layer
  (`formOverrides` targets core keys), so every value is the operator's.
- The platform (`effective-forms.ts`) serves a row as a slot row when its key is not a core key or a
  declared family member of the set, its prefix is an effectively present module, and the form's
  owner is present. A row that holds a kind outside `SLOT_OPERATOR_KINDS`
  (`['label', 'help', 'position', 'hidden']`) is `no-longer-accepted` and is not served. A
  `before` or `after` that names no core key the form shows after code moves, or a `section` the
  form does not declare, is dropped from the served `position` (`position-fallback`).
- `custom_fields.form_layout.set` admits a slot key when it matches
  `<moduleIdRe>.<slotFieldKeyRe>` with a composed module id, its kinds are in
  `SLOT_OPERATOR_KINDS`, and its position names a core key or a section of the form. It cannot tell
  whether the module contributes that slot. The operator screen, which reads the admin
  contributions, lists a row on an undeclared slot as `orphaned`. The kit ignores an entry for a
  slot it does not render.
- The kit replaces the slot's label and help with the operator text in the reader's language, with
  no fallback to another language (FR-092). A hidden slot goes into `formLayout`'s `hidden` by its
  wire key. A position becomes the slot's anchor: `before` or `after` k becomes
  `{ field: k, position }`, and `section` alone becomes `{ section, position: 'end' }`. The slot
  keeps its `weight`. When a row sets both `section` and `before` or `after`, the `before` or
  `after` wins, because the anchor key's section is implied. A section that disagreed with it could
  not be honoured anyway.
- **In the screen's detail response** (`operator-form-layout.md` §2), slot rows have their own
  `slots` array, since the server has no core, code or accepts data for them. `status` (`active`,
  `owner-absent`, `no-longer-accepted`) and the `position-fallback` notice are computed by the
  server, by the same checks it applies to core rows. `orphaned` is computed by the screen, which
  alone can see the slot contributions.
- **A slot value is never required.** If an operator hid a slot whose write hook required its key,
  every create of the host would fail: the kit omits the hidden key, and the hook refuses the slice
  without it. For core fields D-300.12 refuses the equivalent. Slots get the cheaper guarantee:
  `fieldSlotHook` refuses, during registration, a `schema` for which `safeParse({})` fails. Its
  contract already says "every key optional (a partial write)" but did not enforce it. With that
  refusal, `hidden` on a slot is always safe and needs no required-ness check anywhere.
- `formLayout` honours `hidden` for a slot's wire key the way it does for a core key. It emits
  nothing for that slot, but the slot's anchor stays, so the own-module slots anchored on it still
  render. `FORM_LAYOUT_VECTORS` gains that case.

**Where it lands.** The contracts schema, `SLOT_OPERATOR_KINDS`, the `formLayout` line and its
vector, `effective-forms.ts`, the `fieldSlotHook` refusal, the `set` validation and the detail
response's `slots` array all go in WP-L1. WP-L1 produces the rows and
already depends on WP-B, and the corrected `effective-forms.ts` header goes in with it. The kit's
application goes in WP-L2, because WP-L2 depends on WP-C, and its live preview
(`operator-form-layout.md` §6) is a `DeclaredFormSection` that has to show the rows. WP-C changes
nothing. Without rows its behaviour is already correct.

**Rationale.** The owner's D-300.6 gives operators run-time control of how a form reads, and on a
form where a package contributes several fields, hiding or relabelling one of them without
switching the package off is that control's main use. The cost is one optional array, one line in
the shared layout function and a key-shape check on write. The server stays unaware of slots, and
because every kind involved is presentation (FR-100), a row it cannot fully verify cannot change
what an API accepts.

**Rejected.**
- *Rule slot overrides out of scope.* That narrows FR-091 and R-21, both written under the owner's
  D-300.6, to save a few lines, and it leaves the business asking a developer to hide a package's
  field.
- *Make slots manifest data so the server can validate them.* That would add a second declaration
  of every slot (manifest and admin layer) and a reconciliation between them, to verify
  presentation rows that the screen can already classify.
- *A `required` flag on slot contributions, refused for operator `hidden`.* Only the screen could
  see the flag, because slot contributions are admin data. The server's `set` would still accept
  the row, so the instrument that has to be safe could not be. It also adds a declaration kind.
- *Accept the risk.* A presentation setting would then be able to stop every create of a host,
  which FR-100's "presentation only" rules out.
- *Let the kit read the operator rows from `custom_fields`' own routes.* `custom_fields:read` gates
  those routes, but every admin renders forms, and FR-023 gives the admin exactly one source for
  overrides.

### R-25.2: Who enforces `readOnly` (D-300.18)

**Measured.** `DeclaredCoreField` passes `readOnly` to a `{ label, input }` renderer and to a
replacing control. The platform controls (`components/controls/PlatformControl.tsx`) put
`readOnly` on the text, number and textarea inputs, and `disabled` on the switch, select,
multi-select, country and colour controls, where HTML has no read-only state. That split is
correct and stays. `declaredFormSubmission` already leaves a read-only field out of
`core`, so a host input that ignored `readOnly` cannot send its value. It can, however, show an
edited value that the Save then silently discards, because `setCore` and `setSlot` accept the
change.

**Decision.** The host's input honours `readOnly`, as the contract says. The kit adds no
`<fieldset disabled>`, and it drops a change made by the operator to a key it renders read-only
(core or slot). The value stays as loaded. In development the kit warns once per key, naming the
form and the key, so that the host renderer that ignored the prop is visible. A change made by the
form itself (a derivation, a `default`) is unaffected, because D-300.12 relies on a derived
read-only value.

**Rationale.** Read-only and disabled are different states for assistive technology and for the
keyboard (`.claude/skills/ux-laws/SKILL.md` §4: every interactive element keyboard-reachable, and
4.5:1 text contrast). A read-only input stays in the tab order, keeps its value readable and
selectable at full contrast, and is announced as read-only. `<fieldset disabled>` removes every
native control in it from the tab order and announces them as unavailable, and browsers render them
dimmed. A keyboard or screen-reader user would then skip the very value the field exists to show.
It would also be incomplete enforcement. Radix pickers are `button` and `div` widgets that a
fieldset only partly disables, and the `{ field }` renderer and the product editor's `EditorField`
draw their own structure. Inside `FormField`'s `group` mode it would nest one fieldset in another,
which changes how the group is announced. Dropping the change at the kit's one write path enforces
the state for every renderer and makes the screen tell the truth about what Save will send.

**Rejected.**
- *`<fieldset disabled>` per field.* It has the accessibility cost above and does not reach custom
  widgets.
- *`aria-readonly` on the spread control props.* The attribute is not allowed on `button`, which
  is how the pickers render, so axe (`aria-allowed-attr`) would fail for exactly the hosts it was
  meant to help.

### R-25.3: Client rules and the core declaration (D-300.19)

**Measured.** The field-rule check (`field-rule-check.ts`, `field-rules.md` §5) checks only what
is in force from other modules: merged tightenings, `requiredWhen`, formats and the integer format
implied by `platform.integer`. A core `required` or core bound is the host's write schema, which
answers `422 VALIDATION_ERROR` before any hook runs. `EffectiveField.validation` is that merged
conjunction, not the core declaration.

**Decision.** Confirmed. "The same effective rules" in `field-rules.md` §6 means the rules the
field-rule check evaluates. The core declaration's `required` and bounds stay the host's own client
and server validation. The kit shows the core `required` marker but does not check it. §6 now says
so in words.

**Rationale.** Parity is with the check that would refuse the write. Re-checking the core in the kit
would duplicate each adopting host's existing validation and change its messages, timing and order
on adoption, which D-300.5's "adopt without changing behaviour" rules out.

**Rejected.** *The kit also checks core `required` and bounds.* That creates two client validators
per field, with different message keys, that the host would have to reconcile.

### R-25.4: Derivations on an edit form (D-300.20)

**Measured.** The kit derives on an edit form only once a `from` field differs from its loaded value,
which is what WP-C states. The contract's "while untouched" says nothing about edit forms, and read
literally it would re-derive on open and rewrite a stored value that the operator never chose to
change. One defect remains in WP-C. If the operator changes a `from` field and then changes it back,
the derivation stops running, because no `from` field differs any more. The target keeps the value
derived from the intermediate input, and Save sends it.

**Decision.** WP-C's reading is confirmed and completed. On an edit form a derivation writes its
target while (a) the operator has not edited the target in this session, and (b) at least one of its
`from` fields differs from its loaded value. When (a) holds and (b) stops holding, the target returns
to its loaded value. On a create form only (a) applies. FR-044 and `field-rules.md` §4 now say this.

**Rationale.** The target is then always a function of what the operator actually changed: either
the derivation of the current inputs, or the stored value when the net change to the inputs is
none. A round trip of a `from` field therefore leaves the record as stored, which the form's own
dirty tracking and the unsaved-changes prompt also expect.

**Rejected.**
- *Re-derive on open.* That rewrites stored data without any operator action.
- *Stay armed after the first change.* A round trip would then still rewrite the target with
  `compute(loaded inputs)`, which need not equal the stored value, for example after a manual edit
  made before the derivation existed.

### R-25.5: The provider's GET and the ETag (D-300.21)

**Measured.** `registerEffectiveFormsRoutes` (`packages/platform/src/lifecycle/routes.admin.ts`)
sends a strong `ETag` (a SHA-256 digest, quoted) and answers `304` to a matching `If-None-Match`.
It sends no `Cache-Control`, and nothing in `http/server.ts` adds one. The kit's `apiClient` uses
`fetch` with the default cache mode and treats any status other than 2xx as an error. With an
`ETag`, no `Cache-Control` and no `Last-Modified`, a browser has no heuristic freshness, so it
stores the response and revalidates it with `If-None-Match` on every request. Today that works by
default and not by statement. A shared cache in front of a cookie-authenticated admin API is
otherwise unconstrained.

**Decision.** Accepted, with one header. The route sends `Cache-Control: private, no-cache`, which
makes store-and-always-revalidate normative and keeps shared caches out. The kit does not set
`If-None-Match` or a fetch `cache` mode itself. A hand-set conditional header would make a `304`
reach `apiClient`, which would treat it as an error, and the kit would have to keep its own copy of
the body. The header goes in WP-C's merge request, with an assertion in
`routes.admin.forms.test.ts` and a `patch` platform changeset, because the provider depends on it.
The same change removes the route's stale note that the path was "pending the architect's ruling"
(D-300.9 ruled it).

**Rationale.** The browser's HTTP cache is the cache that already exists (IV). One header turns
behaviour that holds by default into behaviour the route states.

**Rejected.**
- *A manual `If-None-Match` with a body cache in the provider.* That duplicates the browser cache
  and adds `304` handling to `apiClient`.
- *`no-store`.* Every refresh would then download the full body, and the `ETag` would be useless.

### R-25.6: When `loader-and-columns-on-one-host` fires (D-300.22)

**Measured.** WP-B2's L4 refuses a module's `adminReads` loader only when the same module's D2
columns on the host's table also carry `adminReads`. `schemaExtensionReads` serves D2 columns only
under `adminReads` (178 OD-178-5), and a loader only under its own `adminReads`. 187 R-17 rule 1
names the collision as "two values under one `extensions.<moduleId>` key".

**Decision.** Confirmed. The refusal covers exactly the pair that would collide on the wire. A
module may keep D2 columns that it does not serve on admin reads, for example for list filters or
indexes, or during a move from columns to a side table, beside an `adminReads` loader. FR-015 now
says that "serve" means opting into `adminReads`.

**Rejected.** *Refuse any loader and columns pair on one host.* It forbids a legitimate layout to
prevent a collision that cannot happen, and the module's migration path from D2 to a side table
would then need a release in which it serves neither.

### R-25.7: When L4 is judged (D-300.23)

**Measured.** The registry reads `columnExtensions()` at each registration, and `composeApp` passes
`activeSchemaExtensions`. The ORM configuration fills it through `recordActiveSchemaExtensions`,
before `verifySchemaExtensions` and before any module registers. But
`schemaExtensionContextRecorded()` exists because "the initial empty context is not a statement
that nothing is declared, so a reader that would *act* on 'nothing declared' asks this first"
(review finding 8). L4 acts on "nothing declared" by admitting the loader. If the composition roots
were reordered, L4 would pass silently.

**Decision.** L4 stays at registration. The reader that `composeApp` and `composeTestServer` pass
as `columnExtensions` throws an internal error when `schemaExtensionContextRecorded()` is false.
The error names the ordering: the ORM configuration must record its declarations before modules
register. The registry calls the reader only for an `adminReads` loader, so a composition with none
never reaches it. One test composes through `composeTestServer` with a module that declares
`adminReads` columns and an `adminReads` loader on `organizations`, and expects the refusal.

**Rationale.** A registration-time refusal is reported at the call that caused it, as L1 to L3 are.
A post-seal check would read the same recorded context, so it gains nothing on ordering and adds a
second refusal phase to the registry. The guard turns the one way L4 can fail, silently, into a
loud failure.

**Rejected.** *A check after sealing.* It has the same dependency on the recorded context, and its
refusal is further from its cause.

### R-25.8: The type of a per-module value (D-300.24)

**Measured.** WP-B2 widens `ExtensionAttributesSchema`'s per-module value from
`record<string, json>` to any JSON value, and `AdminOrganization['extensions']` widens with it. The
only reader of this wire is the declared form: `flattenExtensions` in WP-C's `DeclaredForm.tsx`
reads `extensions.<moduleId>.<key>` and skips a non-object. `field-slots.md` §2 defines a slot's
value as `extensions.<moduleId>.<key>`. A D2 value is always an object. 187 R-17 priced the
widening as "to admit a loader's `T | null`" and did not require any JSON value.

**Decision.** Require object-valued loaders on admin reads. The per-module value becomes
`z.record(z.string(), z.json()).nullable()`, and `ExtensionAttributeMap` follows. In
`schemaExtensionReads`, a parsed loader value that is neither a plain object nor `null` fails the
read with `EntityExtensionLoaderOutputError`. The detail says that an `adminReads` loader answers an
object keyed by field, or `null`. The doc comment on `EntityExtensionLoaderEntry.adminReads` states
the same rule. A loader that does not opt into admin reads keeps any `T` on the 187 read ports.

**Rationale.** The wire exists for slot values, which are addressed by key. An array or scalar
under a module key could never reach a slot and would be dropped silently by the kit. One shape for
D2 and loader values keeps every typed reader at one narrowing (`null`) instead of a JSON switch.
This is narrower than WP-B2's widening and still within R-17's priced cost.

**Rejected.**
- *Any JSON value.* It is wider than any consumer can use, and it pushes a type switch onto every
  reader of `AdminOrganization['extensions']`.
- *Judge the loader's schema at registration.* A Zod schema's output type cannot be read reliably
  at run time. The parse that already happens per value is where the shape is known.

### R-25.9: A missing value (D-300.25)

**Decision.** Confirmed: `null`. A module that is served on the read, but has no row for a record,
answers `null` under its key, as the 187 read ports attach it. An absent key keeps 187 R-17 rule
2's meaning: the module is not served there (not requested, not opted in, absent or switched off).

**Rationale.** The two states are different and the client can use the difference: `null` means
"this module is here and the record has no value", absent means "this module is not here". The kit
treats both as an empty slot, and a diagnostic or a future reader can tell them apart. It also
matches the ports, so a module author learns one rule.

**Rejected.** *Omit the key.* That merges "no value" with "module off", which XVII keeps distinct
everywhere else on this wire.

## R-26: Phase 4 rulings (D-300.26 to D-300.32, architect rulings, 2026-11-28)

WP-E1 (`organizations`, the first adopter, branch `feat/193-e1`) raised five points. The review
of the first rulings (PR #2038) showed that the first D-300.28 contradicted constitution 4.6.0 XV,
so R-26.3 re-rules it, and R-26.6 and R-26.7 add the provisioning and anonymisation rulings that
review asked for. The code cited is
`packages/modules/organizations/src/backend/forms/organization-field-set.ts`,
`packages/contracts/src/organization-form.ts` and the merge and personal-organisation code on that
branch.

### R-26.1: What the organization field set invites (D-300.26)

**Measured.** WP-E1 invites server-enforced kinds on `vatStatus`, `orderConfirmationEmails` and
`fulfilmentStrategy` only, and its reading of I-5 is correct: a kind is invited only on a field that
every writer of it projects.
- `name`, `taxId` and `registeredAddress` are also written by `organization.convert_to_company`.
  Its hook data, `OrganizationConvertToCompanyHookData` in
  `packages/contracts/src/organization-hooks.ts`, is ids and codes only, so no projection can return
  them.
- `parentId` is also written by the hierarchy moves, and `status` by moderation. Neither is
  registered as a writer.

The ids-only rule on that hook data comes from the #1057 amendment of
`specs/176-command-hooks-outbox/contracts/organization-hookable-actions.md`: "ids, codes and field
names only (audit-state list 1), never the tax ID, name or address". It cites
`specs/conventions/audit-state.md` list 1. That convention governs audit state, though, not hook
data, and 176 FR-031 limits only the outbox. Hook data is handed in process to
`beforeCommit` hooks. The `afterCommit` delivery uses the separate outbox type
(`OrganizationConvertToCompanyOutbox`). `OrganizationUpdateHookData`, the admin PATCH's hook data,
already carries the full after-state `OrganizationRecord`, name, tax ID and address included.
`form-field-declaration.md` §4 shows `name` accepting `validation`. A deployment that caps an
organization's name at its ERP's length is the plainest case of a tightened core rule in issue
#2006.

**Decision.** `name` accepts `validation`, and this goes into WP-E1.
- `OrganizationConvertToCompanyHookData` gains `readonly organization: OrganizationRecord`, the
  after-state, as `OrganizationUpdateHookData` has it. Its doc comment drops "never the tax ID, the
  name or the address" and says instead that the outbox data stays ids, codes and field names. Hook
  data is additive-only (`specs/conventions/contract-surface.md`, the *Hook data* row), and a new
  member is additive, so the contracts changeset is a `minor` with an additive note.
  `OrganizationConvertToCompanyOutbox` does not change. The tax ID, name and address now reach the
  conversion's `beforeCommit` hooks, as they already reach `organization.admin_patch`'s. This
  amends 176's #1057 sentence, so WP-DOC adds a 176 addendum line beside T079's 178 and 187
  addenda, and WP-E1 updates the hook-data table in
  `packages/modules/organizations/docs/organizations.md`.
- `organization.convert_to_company`'s Command fills the member from the converted entity.
- The conversion's writer projects `name`, `vatStatus` and `registeredAddress` from it:
  `CONVERT_WRITES = ['name', 'registeredAddress', 'vatStatus']`, with `changed` from
  `changedFields` as now. `taxId` is not projected, because `organization.tax_id.change` still
  cannot project it (R-9). That keeps `taxId` presentation only, whichever writers carry it.
- `name`'s `accepts` gains `validation`. `registeredAddress` stays presentation only, because a
  composite field admits no tightening (`field-rules.md` §1). It is projected anyway, so that a
  later widening is a one-word change.
- `parentId` and `status` stay presentation only for now. Their other writers (the hierarchy
  moves, moderation) are not registered. That is not because they are unhookable: D-300.27 lets
  any Command be a rule-check-only writer, so registering them with hook data that projects the
  field is the route when a case asks for a rule on them. No case does yet (IV), and `accepts`
  may widen later.

**Rationale.** The hook-data restriction protects nothing that the admin PATCH's hook data does not
already expose to the same in-process hooks. Keeping it would hold back the canonical example on a
convention that does not apply to it. "Make the conversion a writer" and "give its hook data values"
are the same change here: the conversion already is a writer, and what it lacks is the values to
project.

**Rejected.**
- *Ship the narrow `accepts` and widen later.* Widening is additive (`accepts` may widen,
  form-field-declaration §5). It would still leave the first adopter unable to show the most
  requested tightening, and the hook-data change is about twenty lines.
- *Register the conversion as a rule-check-only writer as well.* It is a declared hookable action,
  and one action cannot be both. The values have to come through its hook data.
- *Add the tax ID to `organization.tax_id.change`'s hook data too.* No case asks for a tax-ID
  pattern, and the value is normalised before its bound applies (WP-E1's note on `taxId`), so a
  tightening there needs a design of its own (IV).

### R-26.2: `organization.update` as a rule-check-only writer (D-300.27)

**Measured.** `organizationCommandPort.update` (issue #1029) runs `organization.update`. That action
is not declared hookable, and it is not reversible. FR-113 introduced rule-check-only writers for
writes that a stored-revert undo reverses. If the port's write is not a writer at all, a rule binds
the form and the admin API but not the port, which fails SC-002's fourth path.

**Decision.** Confirmed. FR-113 and `field-rules.md` §2 are widened. Any Command that is not a
declared hookable action may be a rule-check-only writer, reversible or not. It supplies
`hookData` for the check alone, and no module hook may register on it. WP-E1 needs no code change.

**Rationale.** The mechanism already admits exactly what the port needs: the check, and no hook.
Reversibility was why the catalog writer had to be rule-check-only. It is not a condition of the
mechanism.

**Rejected.** *Declare `organization.update` hookable.* That would make the integration port a
hook surface, with an outbox type and `expectHookableCommand` obligations, when no module wants to
hook it. A slot cannot ride on it either, because the port carries no `extensions`.

### R-26.3: The merge is held (D-300.28, re-ruled)

**Measured.** The first ruling excluded `organization.merge.finalize` from the writers. Review
showed that this broke constitution 4.6.0 XV, which says "A rule that narrows validation MUST be
enforced on every write the Command Bus runs for that entity, never only in the form". It also
broke FR-045 and the owner's D-300.3 ("every operator, API-key and system write").
- The finalize is a bus Command (`objectType: 'organization'`, `merge-finalize.command.ts` on
  `feat/193-e1`). It writes `name`, `vatStatus`, `registeredAddress`, `fulfilmentStrategy`, `taxId`
  and `orderConfirmationEmails` on the survivor, and D-300.11 holds the fields a write changes.
- The merge is gated only by `organizations:merge`. Excluding it would have made it a route around
  a deployment's `writePermission` on `vatStatus` or `fulfilmentStrategy`. "Restrict the merge
  grant" means withdrawing the merge from those operators altogether.
- The choices are fixed at `organization.merge.start` (`MergeStartCommandInput.fieldChoices`). The
  participants' steps then run, and the finalize runs last (`specs/192-organization-merge/`
  FR-007, forward-only and resumable). A refusal that first appeared at finalize would leave a
  merge *needs attention* after every other module's records had moved.

**Decision.** The merge is held, with no exception. That needs no owner answer, because it is what
XV and D-300.3 already say.
- **At start.** `organization.merge.start` is already hookable with `beforeCommit`, and it becomes
  a writer (mode `update`) of the outcome it fixes. `OrganizationMergeStartHookData` gains
  `survivor: { after: Readonly<Record<string, unknown>>; changed: readonly string[] }`. That is the
  survivor's field values after the choices, with the union of the order-confirmation e-mails,
  computed by the same `effectiveFieldChoices` and union that the finalize applies, in one shared
  function. Hook data is additive-only and stays in process, so the outbox type does not change
  (R-26.1's reasoning). The writer projects that, and `writes` is the merge's offered fields. The
  field-rule check then runs at start:
  - a chosen value that breaks a tightened rule is `422 FIELD_RULE_VIOLATION`;
  - a changed field whose `writePermission` the admin lacks is `403 FIELD_WRITE_FORBIDDEN`;
  - in both cases `details[].path` is the field key, and nothing is recorded, frozen or enqueued.
- **What the merge screen shows.** The refusal is mapped onto the field's choice row by
  `details[].path`. The row reads the rule's message, or "You do not have permission to change this
  field", and offers *Keep the survivor's value*. Choosing it and starting again is the remedy.
  The preview still carries no choices, so the preview cannot refuse a choice; the start is the
  first place that sees one.
- **At finalize.** `organization.merge.finalize` becomes a rule-check-only writer (D-300.27). Its
  Command supplies hook data (`organization`, the survivor's after-state, and `changedFields`).
  This is the backstop XV requires, because a deployment could redeploy with a new rule while a
  merge is in flight. The merge runner runs the finalize inside `enterSystemScope`
  (`packages/platform/src/kernel/merge/runtime.ts`), so its actor is `system`, and its check is
  validation only. `writePermission` is decided once, at start, under the admin who chose. A
  refusal at finalize leaves the merge *needs attention*, as any failing step does (192 FR-007).
  This is a new cause of that state. The refusal's field and code are shown on the merge, and
  *resume* finalizes once the rule admits the value. The start-time check makes this need a rule
  change during a running merge.
- **The e-mail union.** `orderConfirmationEmails` is never a choice: the survivor always takes the
  union of both lists (192 `contracts/organization-merge.md`). It is in `survivor.changed` whenever
  the loser adds a recipient, and it is held like every other changed field, because XV binds the
  validation and the deployment's `writePermission` exists precisely to control who changes the
  recipients. The remedies differ from a choice row's:
  - a validation refusal (`format`, `pattern`, a bound) names the offending recipient's field. The
    operator corrects the loser's or the survivor's recipient list on its own page, where the same
    rule holds, and starts again;
  - a `writePermission` refusal means the merge adds recipients the admin may not change. The
    screen shows it on a read-only *Order confirmation e-mails (combined)* row, naming the
    permission, and the remedy is that an admin who holds it starts the merge.
- **`startMerge` on the port.** `organizationCommandPort.startMerge`, once it exists, runs with the
  ambient actor (192 FR-062). An admin is held exactly as on the screen. A system actor is held to
  validation and, as FR-043 says of every system write, not to `writePermission`.
- **Later improvement, not the control.** The merge screen could lock up front a choice the admin
  may not make. That needs the preview to carry each offered field's effective `writePermission`,
  which is a new read on the sealed registry. It is recorded as a follow-up issue. The server
  refusal above is the control, because a screen is never access control.

**Rationale.** The values a merge copies are already stored, but the survivor's field changes, and
the operator chooses the change. That is an operator write, held like any other (D-300.11). Holding
it at start, where the choice is made, makes the refusal cost nothing. Holding it again at
finalize makes the MUST unconditional.

**Rejected.**
- *Exclude the merge (the first ruling).* It contradicts XV and D-300.3, and it opens a route
  around `writePermission`.
- *Check only at finalize.* A refusal would come after the participants' steps had moved records,
  and the merge would stop *needs attention* for a reason the start could have shown.
- *Check only at start.* XV binds every bus write of the entity, and the finalize is the one that
  writes it.
- *Ask the owner for a merge exception.* Nothing makes one necessary: the check fits both Commands
  with existing mechanisms.

### R-26.4: The provider's `form` prop (D-300.29)

**Measured.** `field-slots.md` §3 showed `<DeclaredFormProvider form={…} values={…} …>`.
`check:admin-forms` (`packages/cli/src/lib/admin-forms.ts`, `FORM_RENDERER`) reads the `form`
attribute of that element, or of its compiled `jsx(DeclaredFormProvider, { form })` twin, to know
which forms a host renders. WP-C shipped `useDeclaredForm({ form, … })` plus
`<DeclaredFormProvider declared>`, so the check could see no form. WP-E1 added an optional `form`
prop that throws when its id differs from `declared.formId`.

**Decision.** Keep WP-E1's prop and make it **required**. The mismatch throw stays.
`field-slots.md` §3 now shows the kit's real shape: renderers are given once to
`useDeclaredForm`, and the provider takes `form` and `declared`. The kit's own tests and its header
example pass `form`. The prop is unreleased API (WP-C merged after 0.112.0), and no consumer in
`../paid-modules` renders it yet, so requiring it breaks nothing published.

**Rationale.** The check reads JSX in source and in compiled packages alike, and the prop is the one
place both forms of a screen show. An optional prop would leave a host that forgot it to
`unrendered-form`, an error that is true but points away from the cause. Required makes the type
checker say it first. The two mentions of the form can only disagree by a developer error, which
the throw reports on the first render in any test.

**Rejected.**
- *Have the check read `useDeclaredForm({ form })` instead.* The hook call may sit in another
  component or file from the render, its options may be built elsewhere, and the merged check and
  its read-size records would change for no gain at run time.
- *Drop `declared` and have the provider build the controller from `form`.* The host needs the
  controller outside the provider (`validate`, `submission`, `applyError` in its Save handler).

### R-26.5: `composeModuleForTest` and the form registry (D-300.30)

**Measured.** `composeModuleForTest` (`packages/test-kit/src/module/index.ts`) builds its context
with no `formRegistry`. `ModuleContext.fieldSets` and `fieldFormats` throw "this composition root
mounts no form registry" when it is absent (`packages/platform/src/kernel/module-context.ts`).
Every adopter's `registerModule` calls `ctx.fieldSets`, so the first unit test that composes
`projects`, `customer_accounts`, `crm` or `catalog` through the helper would throw. WP-E1 fixed the
hand-built `composeModules` roots under `backend/test` with `generatedListForms`.

**Decision.** In WP-E1, `ComposeModuleForTestOptions` gains `formRegistry?: FormRegistry`. When it
is absent, the helper mounts `new FormRegistry()` and does not seal it, because sealing needs the
whole composition. `ComposedModule` exposes it as `formRegistry`, so that a test can assert what the
module registered. The test-kit changeset is a `minor`.

**Rationale.** The helper's promise is "compose one module the way a composition root does", and
both real roots mount a registry. One default in the shared helper replaces four identical fixes
in four work packages.

**Rejected.**
- *Each adopter passes a registry.* That is four copies of the same setup, and the fifth adopter
  meets the throw again.
- *Make `fieldSets` a no-op without a registry.* That reopens the silent partial registration
  D-300.13 refused.

### R-26.6: Personal-organization provisioning (D-300.31)

**Measured.** WP-E1's note said provisioning writes "fixed values outside the Command Bus". Review
showed that to be inaccurate.
- `PersonalOrganizationService.provisionFor` runs inside `customer_account.register_standalone`, a
  bus Command, on the caller's `EntityManager`.
- The name is derived from the first name, last name and e-mail (`personalName`), not fixed.
- `customerAccountCommandPort.createStandalone` is a published port that a system actor can call,
  and it is not buyer self-service.
- The storefront registration *is* a `createStandalone` call:
  `customers/src/backend/services/customer-registration-service.ts` calls it with no options. So a
  flag on the Command type would either bind the storefront or skip every system caller.
- Other paths reach the same service.
  - The federated sign-in seam in `customer_accounts` (`index.ts`) runs
    `withSystemScope(…, () => bus.run(() => emFactory().transactional(…)))`. `bus.run` is a scope,
    not a Command, so there is no root Command there.
  - The detach-to-personal path is `provisionPersonalOrganizationFor`, on its own
    `EntityManager`, which `customers`' `unassign` calls under the operator.
  - The repair path is `ensureForCustomerAccountId`, behind the published
    `personalOrganizationPort.ensureForCustomerAccount`, under whatever actor its caller has. Since
    D-178 it provisions only for an account written before that ruling.
- The fixed values are `status: 'active'`, `vatStatus: 'vat_exempt'`, `taxId: null` and a
  placeholder address. Of these, only `vatStatus` accepts a server-enforced kind (`options`).

**Decision.** Provisioning is a write like any other, and it is held.
- **One Command.** Every path runs `organization.personal.provision`, an `organizations` Command
  (mode `create`, hook data `{ organization: OrganizationRecord }`) registered as a rule-check-only
  writer (D-300.27). `writes` lists `name`, `status`, `vatStatus`, `registeredAddress` and `taxId`.
  The check holds only the keys a writer writes (`guardedKeys` in `field-rule-check.ts`), so a
  tightened `required` on `orderConfirmationEmails` or `fulfilmentStrategy`, which provisioning
  leaves empty, never reaches it.
  - Inside `register_standalone` it runs as a child through that Command's `run`, on the same
    transaction. The internal provisioning port that `organizations` hands `customer_accounts`
    therefore takes `{ em, run }` instead of `em`. As a child it answers `skipAudit`, because the
    caller's entry already records the account and its organisation. Registration's audit is
    unchanged.
  - The federated seam runs it as the root Command, under its system actor, inside the seam's
    transaction, with `buyerSelfService: true` set by the seam.
  - The repair (`ensureForCustomerAccountId`) and the detach-to-personal
    (`provisionPersonalOrganizationFor`) run it as a root Command with their caller's actor. Each
    records one names-only entry, because no caller entry covers them.
  - The stale `command-coverage-ignore` on `provisionFor` goes, because the write is now a Command.
- **Who is bound.** The lineage decides (D-300.10 as amended).
  - The flag is set per call. `createStandalone`'s options gain `buyerSelfService?: true`,
    following `CustomerAccountMemberWritePort.create`'s input (`hookable-writers.md` §1).
    `customers`' storefront registration passes it, and `register_standalone` puts it on the
    Command. This brings forward the `register_standalone` half of T088 into WP-E1, because the
    new writer would otherwise bind the storefront registration until WP-E3 landed.
  - The storefront registration and the federated sign-in are therefore skipped. A system
    `createStandalone` call without the flag is bound, and so are the repair and the detach.
  - Server code running as a `system` actor can declare itself buyer self-service. D-300.10's guard
    stops admin, API-key and impersonated actors only. The flag is a statement in server code, and
    the storefront-route inventory test of T088 is what holds it to the storefront.
- **`writePermission` and fixed values.** A root `create` has `changed` equal to every non-empty
  field, so the detach would refuse an operator who lacks a deployment's `writePermission` on
  `vatStatus`, for `'vat_exempt'`, a value the operator never chose. The provisioning writer
  therefore returns `{ after, changed: ['name'] }`. `name` is the one value derived
  from the person, and `changed` names what the actor chose. The check holds every written field to
  validation on a create whatever `changed` says (`touched = isCreate`), and it uses `changed` for
  `writePermission` only. XV binds validation, not `writePermission`. No platform change is needed,
  and a merge that chooses `'vat_exempt'` is still held, because its `changed` is the merge's.
  - A derived name that breaks a deployment's `name` rule therefore refuses that integration call
    or that detach with `422 FIELD_RULE_VIOLATION` on `name`. That is "every write", and the
    documentation (WP-DOC) tells a deployment that tightens `name` that personal organisations are
    named from the person.
- **System values.** `FieldDeclaration` gains `systemValues?: readonly unknown[]`, the fixed values
  that the owner's system paths write. Composition (`FormRegistry.seal`) checks each against the
  merged tightenings with the check's own `violationsOf`. If one fails, the deployment is refused
  with `rule-excludes-system-value`, naming the field, the value and the module. The organization
  field set declares `systemValues: ['vat_exempt']` on `vatStatus`. Without that refusal, a
  deployment narrowing `vatStatus`'s options would make every bound provisioning fail at run
  time. With it, the configuration is refused at boot. `status` accepts no server-enforced kind and
  needs no entry.

**Rationale.** The XV MUST holds without an exception. A refusal can only come from a rule the
deployment chose, on the one value the request supplied (the person's name). A fixed value can never
be refused, because composition will not admit a rule against it. A field provisioning does not
write is never held, because the check holds only written keys.

**Rejected.**
- *Keep provisioning unregistered.* It is a bus write, and its name is derived input, so this would
  contradict XV.
- *Register a writer on `customer_account.register_standalone`.* The field set's owner would then
  name another module's action. That inverts the dependency, and it would not cover the other
  paths.
- *Exempt personal organisations from `name` rules.* That is an exception XV does not give.
- *Skip `writePermission` platform-wide for a value in `systemValues`.* A merge that chose the
  loser's `'vat_exempt'` would then escape a deployment's `writePermission` on `vatStatus`. The
  exemption belongs to the writer whose value is fixed, not to the value.
- *Extend `systemValues` to the fields provisioning leaves empty.* The narrow `writes` already
  keeps them out of the check, with no declaration.

### R-26.7: Anonymisation (D-300.32)

**Measured.** `PersonalOrganizationService.anonymizeIfOrphaned` is the retention sweep's cascade
over a member-less personal organisation. It runs in `em.transactional`, outside the Command Bus,
and records its own entry through `auditLog.recordWithin` (`organization.anonymized`, null actor,
names and counts only). It writes:
- `name` = `ANONYMIZED_ORGANIZATION_NAME` (`'Deleted customer'`);
- `legalName` = `null`;
- `orderConfirmationEmails` = `[]`;
- `customFieldValues` = `{}`;
- `blockedReason` and `rejectedReason` = `null`;
- placeholder street, city and postal code, keeping the country;
- `deletedAt`, when not already set.

Its `command-coverage-ignore` reason, "a system-initiated scrub on a timer, audited below with the
null actor that fact deserves", is not one of the recognised escape-hatch categories
(`docs/docs/architecture/command-bus.md` § *Auditable write vs. escape hatch*). An erasure of a
durable domain record is an audited domain write, so this is a standing deviation from Principle
XIII, which is non-negotiable. It predates this feature and is tracked in #2039.

**Decision.** Anonymisation is an erasure. It stays outside the bus and is held to no rule, and
this feature changes nothing in its code.
- XV's MUST covers "every write the Command Bus runs", so XV itself needs no exception. That
  conclusion **rests on the XIII deviation above**. When the scrub moves onto the bus, as XIII
  requires, XV will bind it.
- A scrubbed row that breaks a rule added later is a stored value, and stored values are tolerated
  (D-300.4, D-300.11). The row stays editable in its other fields.
- Moving the scrub onto the bus therefore needs a decision first, which must keep erasure
  unrefusable. #2039 carries it as an owner question, with the recommendation: an explicit erasure
  carve-out in XV, worded so that an erasure Command a module declares as such is held to no
  narrowed validation rule and stays audited through the bus. `field-rules.md` §2 records this.

**Rationale.** Erasure is a legal obligation. A tightened rule must not be able to refuse it.
Outside the bus nothing can.

**Rejected.** *Declare the scrub's values as `systemValues` now.* That would refuse legitimate
company-name rules (a `minLength` of 20, a pattern) to protect rows that no write is checked
against. It would also forbid `required` on `orderConfirmationEmails`, which the scrub empties.
