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

## §2 Effective forms (server-served)

`_lifecycle` registers in `packages/platform/src/lifecycle/routes.admin.ts`, beside
`registerModulePresenceRoutes`:

```
GET /api/v1/admin/forms      preHandler: requireAdmin()   (no code — FR-023)
200 EffectiveFormsResponseSchema, ETag
```

> **WP-B note (2026-11-27), pending an architect ruling.** `/api/v1/admin/forms` is already the
> `forms` module's form list (`specs/170-forms-module/`, with `/:id` beneath it), and two owners of
> one path refuse the boot (`FST_ERR_DUPLICATED_ROUTE`). WP-B serves the effective forms at
> `GET /api/v1/admin/effective-forms`; everything else in this section holds as written.

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
export const EffectiveFormsResponseSchema = z.object({
  forms: z.array(z.object({ id: z.string(), fieldSet: z.string(), fields: z.array(EffectiveFieldSchema) })),
});
```

- Only forms of a **present** owner; only overrides of **present** declaring modules (FR-052); a
  `control` of an absent module resolves to `null`.
- Computed per process from the sealed `FormRegistry`, `effectiveState` and the operator layer
  (`FormLayoutOverrideSource` port, operator-form-layout.md §4), memoised per (presence snapshot,
  operator-layer generation); the generation is bumped by `b2b:form-layout:changed` (R-18).
- Layering per field and kind: core → deployment code / granted package → operator
  (operator-form-layout.md §3). Same body for every admin; the admin decides read-only for `writePermission` from
  its own session permissions.
- The admin-kit provider (`packages/admin-kit/src/lib/forms/`) fetches it beside
  `getModulePresence()` and refreshes with it.

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
| `required-not-fillable` | field effectively required on a create form while hidden or read-only there and no `fieldBehaviours` derivation targets it |
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
