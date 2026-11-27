# Data model — Admin form extensions (193)

**One new table: `custom_field_form_layout_overrides`, owned by `custom_fields`** (D-300.6). It is
specified in `contracts/operator-form-layout.md` §1 and created by a `custom_fields` migration
scaffolded with `pnpm --filter backend run migration:new` (no number assigned here). It is
`@GlobalEntity()`, because it holds deployment-wide configuration and no tenant data.

Everything else this feature adds is a declaration (contracts constants, manifest data, admin
contribution data) or a per-process value derived from them. Slot data belongs to the contributing
modules, which store it on the rungs that already exist: a side table (187) or D2 columns (178). The
example fixture overlay owns one side table of that kind.

## 1. Declarations

```text
FieldSetDeclaration  (contracts; owner manifest `fieldSets`)          1 per host entity
 ├─ id                 frozen identity, e.g. 'organization'
 ├─ ownerModuleId      = declaring manifest id
 └─ fields[]           FieldDeclaration
     ├─ key            stable identity; aliases for one release
     ├─ type           FIELD_VALUE_TYPES
     ├─ required, bounds, options, references
     ├─ accepts[]      FIELD_OVERRIDE_KINDS (owner's invitation)
     └─ writePermission?

AdminFormDeclaration (contracts; owner manifest `adminForms`)         n per field set
 ├─ id                 '<fieldSet>.<form>', frozen
 ├─ mode               create | edit
 └─ sections[]         { key, keys[] }   ordered

FieldSetWriters      (owner backend, ctx.fieldSets)                   n per field set
 └─ { on: HookableActionRef(beforeCommit), mode, writes[], project(data) → {before|changed, after} }

AdminFieldContribution (contributor admin layer `fields`)             n per module
 ├─ fieldSet, forms?, key (local), type
 ├─ anchor { field|section, position }, weight
 ├─ labelKey, helpKey?, requiredPermission?, writePermission?, visibleWhen?
 └─ component (lazy)
   ↳ persisted by the contributor's fieldSlotHook into its own side table / D2 columns

FieldOverride        (deployment / granted package manifest `formOverrides`)
 ├─ target '<fieldSet>.<key>', forms?
 ├─ presentation: labelKey, helpKey, placeholderKey, position, default, readOnly, hidden, control,
 │               visibleWhen, maskEnforced
 ├─ enforced:     validation (tightening), requiredWhen, writePermission
 └─ reason

InputControlDeclaration (PLATFORM_INPUT_CONTROLS; module manifest `inputControls`)
 └─ id, outputType, format?, optionsFromField?   + admin `controls` component, + ctx.fieldFormats validator

AdminFieldBehaviour  (deployment / granted package / own-slot admin layer `fieldBehaviours`)
 └─ target, forms?, behaviour (lazy: mask?, derive?)

FormOverrideGrant    (deployment divergence.ts `formOverrideGrants[fieldSetId][]`)
 └─ moduleId, packageName, reason

FormLayoutOverride   (table custom_field_form_layout_overrides; custom_fields)   ≤ 1 per (form, field)
 ├─ formId, fieldKey                          unique together
 ├─ labels / helps / placeholders             { en, pl } — every supported admin language
 ├─ section, before | after, hidden, readOnly
 └─ version, updatedAt
   ↳ written only by custom_fields.form_layout.{set,reset,rekey}; read through FormLayoutOverrideSource
```

## 2. Derived, per process

```text
FormRegistry (sealed at composeModules; immutable for the process, except the operator layer)
 ├─ field sets, forms, writers, controls, formats, overrides, grants   (validated: field-overrides §3)
 └─ effectiveForms(presenceSnapshot, layoutGeneration) → EffectiveFormsResponse   memoised per pair
       layering per field/kind: core → code (deployment / granted package) → operator
       per form, per field: label/help/placeholder refs, section, order, default, readOnly, hidden,
       control|null, visibleWhen, merged validation, requiredWhen, effective writePermission,
       overriddenBy[{module, origin, kinds}]

FieldRuleCheck (one per writer action, first beforeCommit entry, ordering-exempt)
 └─ evaluates the present modules' enforced kinds over project(hookData)
```

Admin side: `DeclaredFormProvider` holds `{ coreValues, extensionValues[moduleId][localKey],
touched, errors }`; layout per field-slots §5; submission splits into `{ core, extensions }`.

## 3. Invariants

| # | Invariant | Held by |
| --- | --- | --- |
| I-1 | A field key named by an anchor, override or condition exists in its field set (or is a live alias, warned) | type-check; `check:admin-forms`; composition |
| I-2 | A core-required field is never hidden; a field required on a create form is fillable there | composition (`hidden-required-field`, `required-not-fillable`) |
| I-3 | Every effective tightening narrows core; the conjunction is satisfiable | composition (`override-loosens-rule`, `override-contradiction`) |
| I-4 | A replacing control's output fits the field type; its format has a server validator | composition (`control-type-mismatch`, `format-without-validator`) |
| I-5 | Every server-enforced kind a field accepts is projected by every writer that writes it | owner composition (`accepts-unenforceable`) + `expectFieldSetWriters` |
| I-6 | A rule the form shows is enforced by the field-rule check on every writer | one source (`GET /api/v1/admin/effective-forms` and the check read one `FormRegistry`) + shared vectors |
| I-7 | A module not effectively present contributes nothing | `effectiveForms(snapshot)`, check step 1, presence predicate, 176 hook skip |
| I-8 | Layout order is a function of declarations only | field-slots §5; shuffled-registration test |
| I-9 | `hidden` / `readOnly` / `visibleWhen` change no API behaviour | FR-062; contract test: API accepts a write to a hidden field |
| I-10 | No tenant data in a declaration or the effective-forms response | shape (no ids beyond module ids); side tables follow host tenancy (187 OR-9) |
| I-11 | An operator override sets only presentation kinds the field accepts; it never hides a required field, never clears a code hidden/read-only | `custom_fields.form_layout.set` validation (FORM_LAYOUT_OVERRIDE_INVALID) |
| I-12 | An operator relabel resolves in every supported admin language, never in another language's text | `language-missing` refusal; fallback to code/core per language |
| I-13 | A product rule applies at every saved scope; `required` binds only the global value | field-rule check scoped mode |

## 4. State transitions

- **Module activation on → off**: its overrides, controls, formats, behaviours, slots leave the
  effective forms at the next presence snapshot; the field-rule check stops applying its kinds; its
  hooks are skipped (176); its side-table rows remain. Off → on restores all with data.
- **Owner renames a key** (release N): new key live, old key in `deprecatedAliases`; anchors and
  overrides on the old key resolve with `deprecated-target` / `deprecated-anchor` warnings. Release
  N+1: alias removed; anything still naming it is refused.
- **Owner narrows `accepts`**: deprecation release first (stable, write); an override relying on the
  removed kind is warned in N, refused in N+1.
- **Operator layout set / reset**: a reversible Command. The pre-state of each row is captured, and
  undo restores it, all-or-nothing per row, with a conflict report on `version`. After commit, the
  write announces `b2b:form-layout:changed`, and every process bumps its generation.
- **Key rename with operator rows**: in the deprecation release, the boot hook runs the `rekey`
  system Command and rewrites alias rows to the live key. In the release that removes the alias, a
  remaining row on the removed key is `orphaned`: it is ignored, listed and deletable.
