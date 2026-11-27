# Contract: field slots (FR-010 – FR-016, R-3 – R-6)

## §1 Contribution (admin layer)

`AdminContributions` (`packages/contracts/src/admin-contributions.ts`) gains three optional arrays:
`fields` (this section), `controls` (`input-controls.md` §3), `fieldBehaviours`
(`field-rules.md` §4).

```ts
export const AdminFieldContributionSchema = z.object({
  fieldSet: z.string(),                         // e.g. 'organization'
  /** Default: every form of the set. */
  forms: z.array(z.string()).min(1).optional(),
  /** Module-local; the wire key is `<moduleId>.<key>`. */
  key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,47}$/),
  type: z.enum(FIELD_VALUE_TYPES),
  anchor: z.union([
    z.object({ field: z.string(), position: z.enum(['before', 'after']) }),
    z.object({ section: z.string(), position: z.enum(['start', 'end']) }),
  ]),
  weight: z.number().int(),
  labelKey: translationKey,                     // contributor's own bundle
  helpKey: translationKey.optional(),
  requiredPermission: PermissionRequirementSchema.optional(),   // render gate
  writePermission: z.string().optional(),       // enforced by fieldSlotHook (§4)
  /** Shown only when true; same vocabulary as overrides (field-rules.md §3). */
  visibleWhen: FieldConditionSchema.optional(),
});
export interface AdminFieldContribution extends z.infer<typeof AdminFieldContributionSchema> {
  /** Default export: ComponentType<FieldSlotProps<T>> (§2). */
  readonly component: AdminComponentFactory;
}
```

`anchor.field` may name a core key of the set (or a live alias, warned) or `<ownModuleId>.<key>`.

## §2 Component props

```ts
export interface FieldSlotProps<T = unknown> {
  readonly formId: string;
  readonly mode: 'create' | 'edit';
  readonly recordId: string | null;             // null on create
  readonly value: T | undefined;                // from the host read's extensions.<moduleId>.<key>
  readonly onChange: (next: T | undefined) => void;
  readonly readOnly: boolean;                   // host read-only, or writePermission missing
  readonly error: string | undefined;           // mapped from extensions.<moduleId>.<key> details
  readonly control: FormFieldControlProps;      // id / aria wiring from the kit's FormField
  /** Read-only view of the form's current core values, for the contributor's own logic. */
  readonly formValues: Readonly<Record<string, unknown>>;
}
```

The kit renders the label, help, error and required marker through `FormField`; the component
renders the input only (IX).

## §3 Host-side rendering (admin-kit)

```tsx
<DeclaredFormProvider form={ORGANIZATION_FORMS.edit} values={values} onChange={…}
                      extensions={record.extensions} errors={fieldErrors} readOnly={!canManage}>
  <DeclaredFormSection section="identity" render={{
    name:     (p) => <Input {...p.control} value={p.value ?? ''} onChange={…} />,
    taxId:    (p) => …,
    parentId: (p) => <OrganizationPicker … />,
  }} />
</DeclaredFormProvider>
```

- `render` is keyed by `SectionKeyOf`/`FieldKeyOf` of the form — a missing renderer for a key the
  section shows is a type error.
- The provider reads the effective overrides (`field-overrides.md` §2) and the slot contributions,
  filtered by presence and `requiredPermission`, and computes the layout (§5).
- `useDeclaredFormSubmission()` returns `{ core, extensions }` for the host's existing request: the
  host merges `extensions` into its body. A field hidden by `hidden` or by `visibleWhen`, and a
  read-only one, is not in `core` (keeps the stored value — the host endpoint merges). The one
  exception: a read-only, visible field that a present `fieldBehaviours` derivation targets on this
  form is in `core` with its derived value, on create always and on edit when the value differs
  from the loaded one (D-300.12; the replacement pattern relies on it). A hidden field is never
  submitted, derived or not.
- The host's existing one-Save session is unchanged; slots fold into the host part (FR-016).

## §4 Server side

- **Host routes.** Each adopting host's admin create and update body schema gains
  `extensions: EntityExtensionsInputSchema.optional()` (`z.record(moduleIdRe, z.unknown())`, at most 8
  keys), forwarded unchanged to `Command.extensions`. Additive (Principle II). `customFieldWrites`
  declarations are unaffected.
- **Reading** (D-300.1): the host's admin detail route accepts `?extensions=<moduleId>[,…]`
  (`ExtensionsQuerySchema`) and answers each named module's D2 columns or its `adminReads: true`
  loader's value under `extensions.<moduleId>`; a module may serve one or the other on one host
  (`loader-and-columns-on-one-host`, refused at composition); an absent or off module's key is
  omitted (187 R-17 rules 1 and 2). The admin form requests exactly the modules whose slots it
  renders.
- **Writing.** `@endora-commerce/platform/kernel` publishes:

```ts
export function fieldSlotHook<S extends z.ZodType>(spec: {
  readonly id: string;
  readonly on: readonly HookableActionRef<unknown>[];   // the field set's writers it extends
  readonly schema: S;                                   // the slice: { <localKey>: value } (partial)
  readonly writePermissions?: Readonly<Record<string, string>>; // localKey → code
  readonly write: (ctx: CommandHookContext<unknown>, slice: z.infer<S>) => Promise<readonly string[]>;
}): CommandHookEntry[];
```

  Absent slice → no-op. Invalid → `422 FIELD_SLOT_INPUT_INVALID`, `details[].path`
  `extensions.<moduleId>.<key>`. A changed key whose `writePermissions` code the actor lacks →
  `403 FIELD_WRITE_FORBIDDEN` (same resolution as `field-rules.md` §5). `write` returns the changed
  field names, which the helper passes to `noteAuditChanges`.
- A slot cannot attach to a `ruleCheckOnly` writer (field-rules §2): such a Command carries no
  `extensions`. Product slot fields are written on `product.create` / `product.update`, global scope
  only (FR-127).
- A slot module MUST declare the field set's owner in `dependencies` (`slot-owner-not-a-dependency`
  in the check; `HookOwnerNotDependedOnError` at composition already holds it server-side).

## §5 Layout algorithm (normative, deterministic)

For one form, after overrides (`field-overrides.md`):

1. Sections in declared order. Within each, core keys in declared order; apply `position` overrides
   (move to another section and/or `before`/`after` a key; ties among moved keys by
   `(moduleId, key)`).
2. For each core key `k` in that order: emit slots anchored `before k` sorted by
   `(weight, moduleId, localKey)`, then `k` (unless hidden — then nothing, but its anchor stays),
   then slots anchored `after k`, same sort. A slot anchored on an own-module slot is emitted after
   / before that slot, recursively, same sort.
3. Section `start` slots before the first item, `end` slots after the last.
4. Drop items whose `visibleWhen` is false for the current values; drop a section with no item.

Registration order, bundle order and process never affect the result (SC-005).

**One implementation (D-300.14).** The algorithm is `formLayout(input)` in
`@endora-commerce/contracts` (`admin-forms.ts`, beside `evaluateFieldCondition`), with step 1
exported on its own as `applyFieldMoves(sections, moves)`. The platform's effective-forms response
calls `applyFieldMoves` to compute `section` and `order`. The admin kit calls `formLayout` with the
server's order and no moves. `check:admin-forms` calls `formLayout` for its own findings and its
determinism test. `FORM_LAYOUT_VECTORS` is run by the contracts' own test. Every sort is by code
point (`a < b`), never `localeCompare`, whose answer depends on the process's ICU locale.

## §6 Check: `admin-forms` analysis

One analysis, `packages/cli/src/lib/admin-forms.ts`, two readers: `check:admin-forms` in this
repository (bare core and every deployment on disk, as `palette-coverage` is judged), and
`endora generate` in an instance (exit 1 after writing). Population: the generated admin registry
plus each deployment's registry, reconciled against the manifests' `fieldSets` / `adminForms`
(independent source; `[admin-forms] read: files=… sites=… sources=manifest-index:…`). Exit 2 on an
empty or short read. Findings:

| Code | Severity |
| --- | --- |
| `unknown-field-set`, `unknown-form`, `unknown-anchor`, `foreign-slot-anchor`, `position-anchor-mismatch`, `duplicate-slot-key`, `slot-owner-not-a-dependency`, `undeclared-form`, `unrendered-form`, `control-without-declaration`, `declaration-without-control` | refusal |
| `required-not-fillable` (a field effectively required on a create form, made `readOnly` there by an override, with no `fieldBehaviours` entry of the same module targeting it on that form; D-300.12) | refusal |
| `ambiguous-slot-order`, `deprecated-anchor` | warning |

How the codes read (D-300.15):

- `position-anchor-mismatch` is a field anchor with `start` or `end`, or a section anchor with
  `before` or `after`. The schema makes this unrepresentable for a typed contribution, so the check
  sees it only in a literal the type system did not hold.
- `unknown-anchor` also fires when the anchor is declared on the field set but not shown on one of
  the forms the slot targets (remedy: narrow the slot's `forms`). A family member anchor
  (`attributeValues.color`) counts as shown where the form shows the family. It also fires for a
  cycle of own-slot anchors, which places none of them. The finding then names every slot in the
  cycle.
- `duplicate-slot-key` fires when one module contributes one key twice to overlapping forms. On
  disjoint forms two contributions are legitimate, for example a different anchor on a create form
  and an edit form. They must still agree on `type` and `writePermission`, because they are one wire
  key and one hook schema, and otherwise the finding fires.

It needs entries in `check-inventory.test.ts`, the `endora check` estate manifest (`package`, phase
admin), `check-read-sizes.ts`, and a companion test (`specs/conventions/check-estate.md`).
