# Contract: deployment field overrides (FR-020 – FR-025, FR-051, R-7, R-8, R-13)

## §1 Manifest declaration

```ts
export const FieldOverrideSchema = z.object({
  /** `<fieldSetId>.<fieldKey>`, e.g. 'organization.emails'. */
  target: z.string(),
  /** Presentation only: narrow to these forms. Server-enforced kinds ignore it (entity-level). */
  forms: z.array(z.string()).min(1).optional(),
  labelKey: translationKey.optional(),          // declaring module's bundle
  helpKey: translationKey.optional(),           // ≤ 280 chars (en), module-i18n budget
  placeholderKey: translationKey.optional(),
  position: z.object({
    section: z.string().optional(),
    before: z.string().optional(),
    after: z.string().optional(),
  }).optional(),                                // at most one of before/after
  default: z.unknown().optional(),              // parsed against the field type at composition
  readOnly: z.boolean().optional(),
  hidden: z.literal(true).optional(),
  control: z.string().optional(),               // input-controls.md
  visibleWhen: FieldConditionSchema.optional(),
  validation: FieldValidationTighteningSchema.optional(),   // field-rules.md §1
  requiredWhen: FieldConditionSchema.optional(),
  writePermission: z.string().optional(),
  /** Mask paired with a server pattern, declared so the report can say which masks bind. */
  maskEnforced: z.boolean().optional(),
  /** Required: the deployment's sentence for the divergence report. */
  reason: z.string().min(1).max(280),
});
// ModuleManifestSchema: formOverrides: z.array(FieldOverrideSchema).max(200).optional()
```

Each present property is one **override kind** (`FIELD_OVERRIDE_KINDS`); `labelKey`→`label`,
`helpKey`→`help`, `placeholderKey`→`placeholder`, `maskEnforced` is part of `behaviour`.

The schema itself refuses an override that sets no kind, and `FieldConditionSchema` refuses an empty
`in` list and an empty `all` or `any` (D-300.16). A tightening whose `minLength` exceeds its
`maxLength`, or whose `min` exceeds its `max`, is **not** refused by the schema: satisfiability is
judged once, over the conjunction of every module's tightenings, by composition's
`override-contradiction` (§3).

## §2 Effective forms (server-served)

`_lifecycle` registers in `packages/platform/src/lifecycle/routes.admin.ts`, beside
`registerModulePresenceRoutes`:

```
GET /api/v1/admin/effective-forms      preHandler: requireAdmin()   (no code — FR-023, D-300.9)
200 EffectiveFormsResponseSchema, ETag, Cache-Control: private, no-cache   (D-300.21)
304 on a matching If-None-Match
```

```ts
export const EffectiveFieldSchema = z.object({
  key: z.string(),
  // A code layer names a bundle key; the operator layer (operator-form-layout.md) carries
  // per-language operator content. The admin resolves the reader's language.
  label: EffectiveTextSchema.optional(),
  help: EffectiveTextSchema.optional(),
  placeholder: EffectiveTextSchema.optional(),
  section: z.string(), order: z.number().int(),           // post-position, per form
  default: z.unknown().optional(),
  readOnly: z.boolean(), hidden: z.boolean(),
  control: z.string().nullable(),                         // null = the host's own renderer
  visibleWhen: FieldConditionSchema.optional(),
  validation: FieldValidationTighteningSchema.optional(), // merged conjunction
  requiredWhen: FieldConditionSchema.optional(),
  writePermission: z.string().optional(),                 // effective (owner's or deployment's)
  overriddenBy: z.array(z.object({ module: z.string(), origin: z.enum(MODULE_ORIGINS), kinds: z.array(z.string()) })),
  /** Kinds the operator layer set on this field (operator-form-layout.md §3). */
  operatorKinds: z.array(z.string()),
});
export const EffectiveTextSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('code'), module: z.string(), key: z.string() }),
  z.object({ source: z.literal('operator'), text: z.record(z.string(), z.string()) }),
]);
/** An operator row on a slot field (D-300.17). Slots have no code layer: every value is the operator's. */
export const SLOT_OPERATOR_KINDS = ['label', 'help', 'position', 'hidden'] as const;
export const EffectiveSlotOverrideSchema = z.object({
  key: z.string(),                                        // wire key '<moduleId>.<localKey>'
  label: EffectiveTextSchema.optional(),                  // source 'operator'
  help: EffectiveTextSchema.optional(),                   // source 'operator'
  position: z.object({ section: z.string().optional(), before: z.string().optional(), after: z.string().optional() }).optional(),
  hidden: z.boolean(),
  operatorKinds: z.array(z.string()),
});
export const EffectiveFormsResponseSchema = z.object({
  forms: z.array(z.object({
    id: z.string(), fieldSet: z.string(), fields: z.array(EffectiveFieldSchema),
    /** Absent: no operator row on a slot of this form. */
    slots: z.array(EffectiveSlotOverrideSchema).optional(),
  })),
});
```

- Only forms for which the owner of the form's field set and the module that renders the form are
  effectively present; only overrides of **present** declaring modules (FR-052); a `control` of an
  absent module resolves to `null`.
- Computed per process from the sealed `FormRegistry`, `effectiveState` and the operator layer
  (`FormLayoutOverrideSource` port, operator-form-layout.md §4), memoised per (presence snapshot,
  operator-layer generation); the generation is bumped by `b2b:form-layout:changed` (R-18).
- Layering per field and kind: core → deployment code / granted package → operator
  (operator-form-layout.md §3). `section` and `order` come from the contracts' `applyFieldMoves`
  (field-slots.md §5 step 1, D-300.14), over the effective `position` of each key: the operator's
  when it set one, else the code override's. An operator move sorts as module `custom_fields`.
  Same body for every admin; the admin decides read-only for `writePermission` from its own session
  permissions.
- **Slot rows (D-300.17).** A stored operator row is a slot row when its key is neither a core key
  nor a declared family member of the set. It is served when the key's module prefix is effectively
  present and the owner of the form's field set and the module that renders the form are
  effectively present. A row that holds a kind outside `SLOT_OPERATOR_KINDS` is not served
  (`no-longer-accepted`). When a row sets both `section` and `before` or `after`, the
  `before` or `after` wins and `section` is ignored, because the anchor key's section is implied. A
  `before` or `after` that names no core key the form shows after code moves, or a `section` the
  form does not declare, is dropped from `position` (`position-fallback`). The server does not know
  which slots exist. The kit ignores an entry for a slot it does not render, and applies the rest:
  operator text replaces the slot's label and help in the reader's language only (FR-092);
  `hidden` puts the wire key into `formLayout`'s `hidden`; `before`/`after` k becomes the anchor
  `{ field: k, position }`, and `section` alone becomes `{ section, position: 'end' }`, with the
  slot's `weight` kept.
- **Caching (D-300.21).** `Cache-Control: private, no-cache`: the browser stores the response and
  revalidates it against the `ETag` on every request, and no shared cache stores it. The admin-kit
  provider (`packages/admin-kit/src/lib/forms/`) does a plain GET beside `getModulePresence()` and
  refreshes with it. It never sets `If-None-Match` or a fetch `cache` mode itself, because a `304`
  reaching `apiClient` is an error there.

## §3 Composition — `FormRegistry.seal` (platform `forms/`, called from `composeModules`)

Input: `fieldSets`, `adminForms`, `formOverrides`, `inputControls` from every composed manifest;
`ctx.fieldSets` writer registrations and `ctx.fieldFormats` validators from backends; the origin map
(189 §2); `formOverrideGrants` from the deployment's `divergence.ts`; the dependency closure; the
permission vocabulary. Refusals are thrown before the first boot hook, each naming module, field set,
field and remedy:

| Code | When |
| --- | --- |
| `unknown-field`, `unknown-section`, `unknown-form` | target / position / forms names nothing declared |
| `override-not-accepted` | kind not in the field's `accepts` |
| `hidden-required-field` | `hidden` on a core-required field |
| `default-on-hidden` | `default` with `hidden` |
| `rule-excludes-system-value` | a tightening rejects a value the field declares in `systemValues` (field-rules.md §2, D-300.31) |
| `required-not-fillable` | field effectively required (core or tightened `required`) on a create form while `hidden` there; no exemption. The `readOnly` case is refused by `check:admin-forms` (field-slots.md §6), which can see `fieldBehaviours` (D-300.12) |
| `override-loosens-rule` | a tightening outside core bounds / enum (field-rules.md §1) |
| `override-contradiction` | the conjunction is unsatisfiable |
| `override-conflict` | two modules set one presentation kind on one field (per form) |
| `control-type-mismatch`, `unknown-control`, `format-without-validator` | input-controls.md §2 |
| `condition-foreign-field` | condition names a field outside field-rules.md §3's scope |
| `unknown-permission` | `writePermission` outside the vocabulary |
| `foreign-override` | origin `core` overriding another module's field set |
| `override-owner-not-a-dependency` | declaring module does not depend on the field set's owner |
| `PackageFormOverrideNotGrantedError` | origin `package`, no grant for that field set (D-300.2) |
| `InvalidFormOverrideGrantError` | grant `unknown-field-set` / `unknown-module` / `not-a-package` / `package-name-mismatch` / `unused` |
| `deprecated-target` | warning (log + divergence `deprecated`) for an alias target; refusal one release later |

## §4 Grants (`divergence.ts`)

`DeploymentDivergenceDeclarationSchema` gains, optional for `commandHookOrder`'s reason:

```ts
formOverrideGrants: z.record(
  z.string(),                                         // field-set id
  z.array(z.object({ moduleId: z.string(), packageName: z.string(), reason: z.string().min(1) })).min(1),
).optional()
```

Semantics are 189 `contracts/module-origin.md` §5 items 1–6, verbatim: a permission, not an origin;
no carry-over; matched on module id **and** installed package name; `package` only; visible in the
report; owned by the deployment.

## §5 Divergence

`DivergenceKind` gains `form-override` (key `form-override:<module>:<fieldSet>.<field>`, detail
`{ kinds, presentationOnly }`, rung 2 — the owner's `accepts` is the invitation, as a hookable
action is) and `form-override-grant` (rung 2, as 188's grant is rung-of-its-point). The derivation is
from the manifest declaration, in `packages/cli/src/lib/divergence.ts`, as `command-middleware`'s is.
Slot fields are `notRecorded` (own surface); their hooks are already `command-hook` entries.
