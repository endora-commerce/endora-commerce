# Contract: input control registry (FR-030 – FR-033, R-10)

## §1 Data half

```ts
// packages/contracts/src/admin-forms.ts
export const InputControlDeclarationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-zA-Z0-9]*$/),   // 'platform.tel', '<moduleId>.<name>'
  outputType: z.enum(FIELD_VALUE_TYPES),
  format: z.string().optional(),            // a FIELD_FORMATS id or '<moduleId>.<name>'
  /** For select-like controls: the control lists the field's options (implies an options subset). */
  optionsFromField: z.boolean().optional(),
});

export const PLATFORM_INPUT_CONTROLS = [
  { id: 'platform.text',        outputType: 'string' },
  { id: 'platform.textarea',    outputType: 'string' },
  { id: 'platform.email',       outputType: 'string', format: 'email' },
  { id: 'platform.tel',         outputType: 'string', format: 'tel' },
  { id: 'platform.url',         outputType: 'string', format: 'url' },
  { id: 'platform.number',      outputType: 'decimal' },
  { id: 'platform.integer',     outputType: 'integer' },
  { id: 'platform.decimal',     outputType: 'decimal' },
  { id: 'platform.switch',      outputType: 'boolean' },
  { id: 'platform.select',      outputType: 'enum',     optionsFromField: true },
  { id: 'platform.multiselect', outputType: 'enum[]',   optionsFromField: true },
  { id: 'platform.date',        outputType: 'date' },
  { id: 'platform.country',     outputType: 'string', format: 'country' },
  { id: 'platform.color',       outputType: 'string', format: 'color' },
] as const satisfies readonly InputControlDeclaration[];

export const FIELD_FORMATS = ['email', 'tel', 'url', 'country', 'color'] as const;
```

Platform formats' server validators live in `@endora-commerce/platform` (`forms/formats.ts`), their
client twins in admin-kit; one test table feeds both (same accept/refuse vectors).

A module declares `inputControls` in its manifest; its admin layer exports
`controls: [{ id, component }]`; its backend registers each module format:

```ts
ctx.fieldFormats([{ id: '<moduleId>.nip', validate: (value: string) => boolean }]);
```

## §2 Fit table (normative)

| Field `type` | A control fits when its `outputType` is | Implied tightening |
| --- | --- | --- |
| `string` | `string` (with or without `format`), or `enum` with `optionsFromField` **only if** the override also declares `validation.options` | `format`; `options` |
| `integer` | `integer` | — |
| `decimal` | `decimal` or `integer` | `integer` implies a whole-number rule |
| `boolean` | `boolean` | — |
| `date` / `datetime` | the same | — |
| `enum` | `enum` | options ⊆ core enum (always) |
| `string[]` / `enum[]` | the same | — |
| `reference`, `reference[]`, `composite` | **never** (the host's renderer only; `control` is not accepted) | — |

Everything else is `control-type-mismatch`. Examples: `platform.tel` on `string` fits and implies
`format: tel`; `platform.number` (`decimal`) on `string` is refused; `platform.integer` on
`decimal` fits.

## §3 Refusals and presence

- `unknown-control` — the id is neither a platform control nor a present-or-absent declared one.
- `control-type-mismatch` — §2.
- `format-without-validator` — a declared `format` that is neither a `FIELD_FORMATS` id nor a
  `ctx.fieldFormats` registration of the control's own module.
- `control-without-declaration` / `declaration-without-control` — admin-forms check (field-slots §6).
- A selected module control whose module is absent: the effective field's `control` is `null` (host
  renderer) and its format is not enforced (R-14); the override's other kinds still apply if the
  declaring module is present.
