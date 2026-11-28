# Contract: field sets and admin forms (FR-001 – FR-005, R-1, R-2)

Home: `@endora-commerce/contracts`, a new generic file `src/admin-forms.ts` plus one file per host
family (`src/organization-form.ts` first). Proposed; the names are binding once WP-A lands.

## §1 Types

```ts
// src/admin-forms.ts
export const FIELD_VALUE_TYPES = [
  'string', 'integer', 'decimal', 'boolean', 'date', 'datetime',
  'enum', 'string[]', 'enum[]', 'reference', 'reference[]', 'composite',
] as const;
export type FieldValueType = (typeof FIELD_VALUE_TYPES)[number];

export const FIELD_OVERRIDE_KINDS = [
  'label', 'help', 'placeholder', 'position', 'default', 'readOnly', 'hidden',
  'control', 'behaviour', 'visibleWhen',              // presentation
  'validation', 'requiredWhen', 'writePermission',    // server-enforced
] as const;
export type FieldOverrideKind = (typeof FIELD_OVERRIDE_KINDS)[number];
export const PRESENTATION_OVERRIDES: readonly FieldOverrideKind[]; // the first ten

export interface FieldDeclaration<K extends string = string> {
  readonly key: K;                              // camelCase or dotted family `attributeValues.*`
  readonly type: FieldValueType;
  /** For `enum` / `enum[]`: the core vocabulary. An `options` override must be a subset. */
  readonly options?: readonly string[];
  /** Required on create by core. `hidden` is refused on it. */
  readonly required: boolean;
  /** Core bounds; an override may only narrow them. */
  readonly bounds?: { minLength?: number; maxLength?: number; min?: number; max?: number };
  /** For `reference`: the referenced entity, informational (e.g. 'organization'). */
  readonly references?: string;
  readonly accepts: readonly FieldOverrideKind[];
  /** Owner-declared write permission (FR-060); a deployment may add one, never remove. */
  readonly writePermission?: string;
  /** Renamed keys still accepted for one release (FR-071). */
  readonly deprecatedAliases?: readonly { key: string; since: string }[];
}

export interface FieldSetDeclaration<K extends string = string> {
  /** `<host>`, e.g. 'organization'. Frozen identity. One per host entity. */
  readonly id: string;
  /** The owning module id — must equal the declaring manifest's id. */
  readonly ownerModuleId: string;
  readonly fields: readonly FieldDeclaration<K>[];
}

export interface AdminFormDeclaration<K extends string = string, S extends string = string> {
  /** `<fieldSetId>.<form>`, e.g. 'organization.create'. Frozen identity. */
  readonly id: string;
  readonly fieldSet: string;
  readonly mode: 'create' | 'edit';
  /** Ordered; each lists the keys it shows, in order. A key appears in at most one section. */
  readonly sections: readonly { readonly key: S; readonly keys: readonly K[] }[];
}

export function defineFieldSet<const F extends FieldSetDeclaration>(f: F): F;
export function defineAdminForm<const F extends AdminFormDeclaration>(f: F): F;
export type FieldKeyOf<F> = /* literal union of F['fields'][number]['key'] */;
export type SectionKeyOf<F> = /* literal union of section keys */;
```

Zod twins (`FieldSetDeclarationSchema`, `AdminFormDeclarationSchema`) validate the data half for
`defineModuleManifest`.

## §2 Manifest fields

`ModuleManifestSchema` gains, all optional:

| Field | Shape | Who may declare |
| --- | --- | --- |
| `fieldSets` | `FieldSetDeclaration[]` | the owner of the host; `ownerModuleId` must equal the manifest id |
| `adminForms` | `AdminFormDeclaration[]` | the module whose screen renders the form; it depends on the field set's owner (FR-083) — e.g. `customers` declares `customer.edit` over `customer_accounts`' `customer_account` set |
| `formOverrides` | `contracts/field-overrides.md` §1 | `deployment`; `package` under grant |
| `inputControls` | `contracts/input-controls.md` §1 | any origin |

A field-set id or form id declared twice across the composition is refused (`duplicate-field-set`,
`duplicate-form`).

## §3 Rules the owner's declaration must satisfy (composition, owner side)

| Rule | Refusal |
| --- | --- |
| `key` unique within the set; aliases unique and not live keys | `duplicate-field-key` |
| every form key is a field of its set; a key in at most one section per form | `unknown-field`, `duplicate-form-key` |
| `hidden` in `accepts` on a `required` field | `accepts-hidden-on-required` |
| `validation` / `requiredWhen` / `writePermission` in `accepts` on a field some declared writer does not project | `accepts-unenforceable` (see `field-rules.md` §2) |
| `options` present iff type is `enum` / `enum[]` | `options-type-mismatch` |
| `writePermission` names a code outside the platform vocabulary | `unknown-permission` |
| `composite` field accepts `control` | `accepts-control-on-composite` |

## §4 Example (organizations, first adopter)

```ts
// packages/contracts/src/organization-form.ts
export const ORGANIZATION_FIELD_SET = defineFieldSet({
  id: 'organization',
  ownerModuleId: 'organizations',
  fields: [
    { key: 'name',      type: 'string', required: true,  bounds: { maxLength: 255 },
      accepts: ['label', 'help', 'placeholder', 'position', 'control', 'behaviour', 'validation'] },
    { key: 'taxId',     type: 'string', required: true,  bounds: { minLength: 8, maxLength: 32 },
      accepts: ['label', 'help', 'placeholder', 'position', 'behaviour'] }, // not projected by tax_id.change (R-9)
    { key: 'parentId',  type: 'reference', references: 'organization', required: false,
      accepts: [...PRESENTATION_OVERRIDES] },
    { key: 'registeredAddress', type: 'composite', required: true, accepts: ['label', 'help', 'position'] },
    { key: 'emails',    type: 'string[]', required: false,
      accepts: [...PRESENTATION_OVERRIDES, 'validation', 'requiredWhen', 'writePermission'] },
    // …
  ],
});
export const ORGANIZATION_FORMS = {
  create: defineAdminForm({ id: 'organization.create', fieldSet: 'organization', mode: 'create',
    sections: [{ key: 'identity', keys: ['name', 'taxId', 'parentId'] },
               { key: 'address',  keys: ['registeredAddress'] }] }),
  edit:   defineAdminForm({ id: 'organization.edit', fieldSet: 'organization', mode: 'edit', sections: [/* … */] }),
} as const;
```

The exact field list is the WP-E task (it is the organization write contract's, field by field); the
above fixes the shape, not the inventory. As shipped (D-300.26), `name` accepts `validation`: the
conversion's hook data carries the after-state record, so every writer of `name` projects it.
`taxId`, `registeredAddress`, `parentId` and `status` accept presentation kinds only, because a
writer of each cannot project it (`organization.tax_id.change`) or is not hookable (hierarchy
moves, moderation), or because a composite admits no tightening.

## §5 Contract-surface rows (added to `specs/conventions/contract-surface.md` by WP-H)

| Kind | Entries derived from | Tier | Direction |
| --- | --- | --- | --- |
| Field-set id, admin form id | `defineFieldSet` / `defineAdminForm` constants in `packages/contracts/src` | frozen | identity |
| Field key, section key | members of those constants | stable | identity |
| Field value type and core bounds | the field declaration | stable | read |
| `accepts` | the field declaration | stable | write (widening compatible) |
| Platform input control id and output type | `PLATFORM_INPUT_CONTROLS` | stable | identity |
| Field format id | `FIELD_FORMATS` | additive-only | identity |
| Field-rule violation codes | `FIELD_RULE_CODES` | additive-only | read |

Manifest fields `fieldSets`, `adminForms`, `formOverrides`, `inputControls` are covered by the
existing *Manifest extension fields* row (stable, write).
