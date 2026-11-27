// Admin form extensions — `specs/193-admin-form-extensions/` WP-A (ruling D-300),
// `contracts/form-field-declaration.md`, `field-overrides.md`, `field-rules.md`,
// `input-controls.md`, `field-slots.md` §1 and `operator-form-layout.md` §4.
//
// The platform-free half of the mechanism:
//
// - **Declarations** an owner writes beside its write schemas: a field set per
//   host entity (`defineFieldSet`) and the admin forms laid out over it
//   (`defineAdminForm`), both plain data with literal key types.
// - **Vocabularies** every other half names: value types, override kinds,
//   operator kinds, field-rule codes, platform input controls and formats.
// - **Schemas** for the manifest fields (`fieldSets`, `adminForms`,
//   `formOverrides`, `inputControls`), the admin contributions (`fields`,
//   `controls`, `fieldBehaviours`) and the effective-forms response.
// - **The condition evaluator**, one pure function the admin form and the
//   server-side field-rule check both call (FR-040), so the rule a form shows
//   and the rule the server enforces cannot drift.
//
// What needs every composed manifest (unknown fields, grants, dependencies,
// the permission vocabulary, writers) is the platform's `FormRegistry.seal`;
// what one declaration can decide alone is refused here, at definition time.

import { z } from 'zod';
import { PermissionRequirementSchema, type AdminComponentFactory } from './admin-contributions.js';
import type { ModuleOrigin } from './modules.js';

// ---------------------------------------------------------------------------
// Identifier patterns
// ---------------------------------------------------------------------------

/** A field-set id: the host, lower snake case (`organization`, `customer_account`). Frozen identity. */
export const fieldSetIdRe = /^[a-z][a-z0-9_]*$/;

/**
 * A declared field key: camelCase, or a dotted family whose member is data
 * (`attributeValues.*`, FR-082, FR-123).
 */
export const fieldKeyRe = /^[a-z][a-zA-Z0-9]*(?:\.(?:\*|[a-z][a-zA-Z0-9_]*))?$/;

/**
 * A field **reference** — what an override target, an anchor or a condition
 * names: a core key, one member of a family (`attributeValues.color`), or a
 * slot field on the wire (`<moduleId>.<localKey>`).
 */
export const fieldReferenceRe = /^_?[a-z][a-zA-Z0-9_]*(?:\.[a-z][a-zA-Z0-9_]*)?$/;

/** A section key: camelCase, unique within its form. Stable identity. */
export const sectionKeyRe = /^[a-z][a-zA-Z0-9]*$/;

/** `<fieldSetId>.<form>`, e.g. `organization.create`. Frozen identity. */
export const adminFormIdRe = /^[a-z][a-z0-9_]*\.[a-z][a-zA-Z0-9_]*$/;

/** `<fieldSetId>.<fieldReference>`, e.g. `organization.emails` or `organization.acme_erp.code`. */
export const fieldTargetRe = /^[a-z][a-z0-9_]*\.(?:_?[a-z][a-zA-Z0-9_]*(?:\.[a-z][a-zA-Z0-9_]*)?)$/;

/** A slot field's module-local key; the wire key is `<moduleId>.<key>` (FR-010). */
export const slotFieldKeyRe = /^[a-z][a-zA-Z0-9]{0,47}$/;

/** `platform.<name>` or `<moduleId>.<name>`. */
export const inputControlIdRe = /^[a-z][a-z0-9_]*\.[a-z][a-zA-Z0-9]*$/;

/** A module format, `<moduleId>.<name>`; a platform format is one of {@link FIELD_FORMATS}. */
export const moduleFieldFormatRe = /^_?[a-z][a-z0-9_]*\.[a-z][a-zA-Z0-9]*$/;

/**
 * A module-relative translation key, the rule `admin-contributions.ts` applies
 * to every `labelKey`: a nested bundle object fails to load and the field
 * renders its raw key.
 */
const translationKey = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)*$/, 'Translation key must be dot-separated camelCase namespaces');

const permissionCode = z.string().min(1).max(128);

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

/** What a field's value is. Stable, read (`form-field-declaration.md` §5). */
export const FIELD_VALUE_TYPES = [
  'string', 'integer', 'decimal', 'boolean', 'date', 'datetime',
  'enum', 'string[]', 'enum[]', 'reference', 'reference[]', 'composite',
] as const;
export type FieldValueType = (typeof FIELD_VALUE_TYPES)[number];

/**
 * What a deployment may change about a field. The owner opts each field in
 * through `accepts`, which is the invitation (R-8). Stable, write: widening is
 * compatible, narrowing needs a deprecation release.
 */
export const FIELD_OVERRIDE_KINDS = [
  'label', 'help', 'placeholder', 'position', 'default', 'readOnly', 'hidden',
  'control', 'behaviour', 'visibleWhen',
  'validation', 'requiredWhen', 'writePermission',
] as const;
export type FieldOverrideKind = (typeof FIELD_OVERRIDE_KINDS)[number];

/** The ten kinds that change only what the form shows (FR-062: no API reads them). */
export const PRESENTATION_OVERRIDES = [
  'label', 'help', 'placeholder', 'position', 'default', 'readOnly', 'hidden',
  'control', 'behaviour', 'visibleWhen',
] as const satisfies readonly FieldOverrideKind[];

/** The three kinds the platform's field-rule check enforces on every writer (FR-041). */
export const SERVER_ENFORCED_OVERRIDES = ['validation', 'requiredWhen', 'writePermission'] as const satisfies readonly FieldOverrideKind[];

/**
 * The kinds a business operator may set on the operator layout screen
 * (FR-091, `operator-form-layout.md` §2). Slot fields admit `label`, `help`,
 * `position` and `hidden` of these.
 */
export const OPERATOR_KINDS = ['label', 'help', 'placeholder', 'position', 'hidden', 'readOnly'] as const satisfies readonly FieldOverrideKind[];
export type OperatorKind = (typeof OPERATOR_KINDS)[number];

/** `details[].code` of `422 FIELD_RULE_VIOLATION` (`field-rules.md` §5). Additive-only. */
export const FIELD_RULE_CODES = [
  'required', 'too_short', 'too_long', 'below_min', 'above_max', 'not_an_option', 'pattern', 'format',
] as const;
export type FieldRuleCode = (typeof FIELD_RULE_CODES)[number];

/**
 * Platform field formats: validated by `@endora-commerce/platform` on the
 * server and by admin-kit twins on the client, from one vector table
 * (`admin-forms.vectors.ts`). Additive-only.
 */
export const FIELD_FORMATS = ['email', 'tel', 'url', 'country', 'color'] as const;
export type FieldFormat = (typeof FIELD_FORMATS)[number];

// ---------------------------------------------------------------------------
// Conditions (`field-rules.md` §3, research R-11)
// ---------------------------------------------------------------------------

export type FieldCondition =
  | { readonly field: string; readonly op: 'equals' | 'notEquals'; readonly value: string | number | boolean | null }
  | { readonly field: string; readonly op: 'in'; readonly value: readonly (string | number)[] }
  | { readonly field: string; readonly op: 'isEmpty' | 'isNotEmpty' }
  | { readonly all: readonly FieldCondition[] }
  | { readonly any: readonly FieldCondition[] }
  | { readonly not: FieldCondition };

/** Levels, a leaf included: `{ field, op }` is depth 1. */
export const FIELD_CONDITION_MAX_DEPTH = 4;
/** Leaf conditions in one tree, counted across every branch. */
export const FIELD_CONDITION_MAX_LEAVES = 16;

const conditionField = z.string().regex(fieldReferenceRe);

const FieldConditionNodeSchema: z.ZodType<FieldCondition> = z.lazy(() =>
  z.union([
    z.strictObject({
      field: conditionField,
      op: z.enum(['equals', 'notEquals']),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }),
    z.strictObject({ field: conditionField, op: z.literal('in'), value: z.array(z.union([z.string(), z.number()])).min(1).readonly() }),
    z.strictObject({ field: conditionField, op: z.enum(['isEmpty', 'isNotEmpty']) }),
    // An empty `all` is vacuously true and an empty `any` false: neither is a
    // condition anybody means to write, so both are refused.
    z.strictObject({ all: z.array(FieldConditionNodeSchema).min(1).readonly() }),
    z.strictObject({ any: z.array(FieldConditionNodeSchema).min(1).readonly() }),
    z.strictObject({ not: FieldConditionNodeSchema }),
  ]),
);

function conditionShape(condition: FieldCondition): { depth: number; leaves: number } {
  if ('all' in condition || 'any' in condition) {
    const children = 'all' in condition ? condition.all : condition.any;
    let depth = 0;
    let leaves = 0;
    for (const child of children) {
      const shape = conditionShape(child);
      depth = Math.max(depth, shape.depth);
      leaves += shape.leaves;
    }
    return { depth: depth + 1, leaves };
  }
  if ('not' in condition) {
    const shape = conditionShape(condition.not);
    return { depth: shape.depth + 1, leaves: shape.leaves };
  }
  return { depth: 1, leaves: 1 };
}

/** `visibleWhen` / `requiredWhen`: a closed vocabulary, depth ≤ 4, leaves ≤ 16. */
export const FieldConditionSchema: z.ZodType<FieldCondition> = FieldConditionNodeSchema.superRefine((condition, ctx) => {
  const { depth, leaves } = conditionShape(condition);
  if (depth > FIELD_CONDITION_MAX_DEPTH) {
    ctx.addIssue({ code: 'custom', message: `A field condition is ${depth} levels deep; the maximum depth is ${FIELD_CONDITION_MAX_DEPTH}.` });
  }
  if (leaves > FIELD_CONDITION_MAX_LEAVES) {
    ctx.addIssue({ code: 'custom', message: `A field condition has ${leaves} leaves; the maximum is ${FIELD_CONDITION_MAX_LEAVES} leaves.` });
  }
});

function valueOf(values: Readonly<Record<string, unknown>>, field: string): unknown {
  // An own key only: `constructor` is not a value somebody entered.
  return Object.prototype.hasOwnProperty.call(values, field) ? values[field] : undefined;
}

/** `undefined`, `null`, a string that is empty after trimming, or an empty array. Nothing else. */
export function isEmptyFieldValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function equalsValue(actual: unknown, expected: string | number | boolean | null): boolean {
  // `null` stands for "no value", which an absent key is too.
  if (expected === null) return actual === null || actual === undefined;
  // On an array-valued field (`enum[]`, `string[]`) equality is membership.
  if (Array.isArray(actual)) return actual.includes(expected);
  return actual === expected;
}

/**
 * Evaluate a condition over flat field values: core keys, family members and
 * slot keys (`<moduleId>.<key>`) are all own keys of `values`, never paths.
 * Strict equality, no coercion. Pure: the admin form and the platform's
 * field-rule check both call it (FR-040).
 */
export function evaluateFieldCondition(condition: FieldCondition, values: Readonly<Record<string, unknown>>): boolean {
  if ('all' in condition) return condition.all.every((child) => evaluateFieldCondition(child, values));
  if ('any' in condition) return condition.any.some((child) => evaluateFieldCondition(child, values));
  if ('not' in condition) return !evaluateFieldCondition(condition.not, values);
  const actual = valueOf(values, condition.field);
  switch (condition.op) {
    case 'equals':
      return equalsValue(actual, condition.value);
    case 'notEquals':
      return !equalsValue(actual, condition.value);
    case 'in': {
      const listed = condition.value as readonly unknown[];
      if (Array.isArray(actual)) return actual.some((member) => listed.includes(member));
      return listed.includes(actual);
    }
    case 'isEmpty':
      return isEmptyFieldValue(actual);
    case 'isNotEmpty':
      return !isEmptyFieldValue(actual);
  }
}

// ---------------------------------------------------------------------------
// Field sets and admin forms (`form-field-declaration.md` §1, §3)
// ---------------------------------------------------------------------------

export interface FieldBounds {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
}

export interface FieldDeclaration<K extends string = string> {
  /** Stable identity: camelCase, or a dotted family `attributeValues.*`. */
  readonly key: K;
  readonly type: FieldValueType;
  /** For `enum` / `enum[]` only: the core vocabulary. An `options` tightening must be a subset. */
  readonly options?: readonly string[];
  /** Required on create by core. `hidden` is refused on it. */
  readonly required: boolean;
  /** Core bounds; an override may only narrow them. On `string[]` the length bounds are per element. */
  readonly bounds?: FieldBounds;
  /** For `reference` / `reference[]`: the referenced entity, informational (e.g. `organization`). */
  readonly references?: string;
  /** The override kinds this field invites (R-8). */
  readonly accepts: readonly FieldOverrideKind[];
  /** Owner-declared write permission (FR-060); a deployment may add one, never remove it. */
  readonly writePermission?: string;
  /** Renamed keys still accepted for one release (FR-071). */
  readonly deprecatedAliases?: readonly { readonly key: string; readonly since: string }[];
}

export interface FieldSetDeclaration<K extends string = string> {
  /** `<host>`, e.g. `organization`. Frozen identity. One per host entity. */
  readonly id: string;
  /** The owning module id; must equal the declaring manifest's id. */
  readonly ownerModuleId: string;
  readonly fields: readonly FieldDeclaration<K>[];
}

export interface AdminFormSection<K extends string = string, S extends string = string> {
  readonly key: S;
  /** The keys this section shows, in order. */
  readonly keys: readonly K[];
}

export interface AdminFormDeclaration<K extends string = string, S extends string = string> {
  /** `<fieldSetId>.<form>`, e.g. `organization.create`. Frozen identity. */
  readonly id: string;
  readonly fieldSet: string;
  readonly mode: 'create' | 'edit';
  /** Ordered; a key appears in at most one section. */
  readonly sections: readonly AdminFormSection<K, S>[];
}

/** The literal union of a field set's keys, or of the keys a form shows. */
export type FieldKeyOf<F> = F extends { readonly fields: readonly (infer E)[] }
  ? E extends { readonly key: infer K extends string }
    ? K
    : never
  : F extends { readonly sections: readonly (infer S)[] }
    ? S extends { readonly keys: readonly (infer K extends string)[] }
      ? K
      : never
    : never;

/** The literal union of a form's section keys. */
export type SectionKeyOf<F> = F extends { readonly sections: readonly (infer S)[] }
  ? S extends { readonly key: infer K extends string }
    ? K
    : never
  : never;

const FieldBoundsSchema = z
  .strictObject({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .superRefine((bounds, ctx) => {
    if (bounds.minLength !== undefined && bounds.maxLength !== undefined && bounds.minLength > bounds.maxLength) {
      ctx.addIssue({ code: 'custom', message: `minLength ${bounds.minLength} is above maxLength ${bounds.maxLength}.` });
    }
    if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max) {
      ctx.addIssue({ code: 'custom', message: `min ${bounds.min} is above max ${bounds.max}.` });
    }
  });

export const FieldDeclarationSchema = z.strictObject({
  key: z.string().max(64).regex(fieldKeyRe),
  type: z.enum(FIELD_VALUE_TYPES),
  options: z.array(z.string().min(1)).min(1).readonly().optional(),
  required: z.boolean(),
  bounds: FieldBoundsSchema.optional(),
  references: z.string().regex(fieldSetIdRe).optional(),
  accepts: z.array(z.enum(FIELD_OVERRIDE_KINDS)).readonly(),
  writePermission: permissionCode.optional(),
  deprecatedAliases: z
    .array(z.strictObject({ key: z.string().max(64).regex(fieldKeyRe), since: z.string().regex(/^\d+\.\d+\.\d+$/) }))
    .readonly()
    .optional(),
});

const isEnumType = (type: FieldValueType): boolean => type === 'enum' || type === 'enum[]';

/** The data half of {@link FieldSetDeclaration}, with the §3 rules one declaration decides. */
export const FieldSetDeclarationSchema = z
  .strictObject({
    id: z.string().max(64).regex(fieldSetIdRe),
    ownerModuleId: z.string().regex(/^_?[a-z][a-z0-9_]*$/),
    fields: z.array(FieldDeclarationSchema).min(1).readonly(),
  })
  .superRefine((set, ctx) => {
    const live = new Set<string>();
    for (const [index, field] of set.fields.entries()) {
      if (live.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'key'],
          message: `duplicate-field-key: '${field.key}' is declared twice in field set '${set.id}'.`,
        });
      }
      live.add(field.key);
    }
    const aliases = new Set<string>();
    for (const [index, field] of set.fields.entries()) {
      const path = ['fields', index];
      for (const alias of field.deprecatedAliases ?? []) {
        if (live.has(alias.key) || aliases.has(alias.key)) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'deprecatedAliases'],
            message: `duplicate-field-key: alias '${alias.key}' of '${field.key}' in field set '${set.id}' is a live key or another alias.`,
          });
        }
        aliases.add(alias.key);
      }
      if ((field.options !== undefined) !== isEnumType(field.type)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'options'],
          message: `options-type-mismatch: '${field.key}' in field set '${set.id}' is '${field.type}'; options are declared on enum and enum[] fields, and only there.`,
        });
      }
      if (field.required && field.accepts.includes('hidden')) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'accepts'],
          message: `accepts-hidden-on-required: '${field.key}' in field set '${set.id}' is required on create and cannot accept 'hidden'.`,
        });
      }
      if (field.type === 'composite' && field.accepts.includes('control')) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'accepts'],
          message: `accepts-control-on-composite: '${field.key}' in field set '${set.id}' is composite; only the host renders it, so it cannot accept 'control'.`,
        });
      }
    }
  });

const AdminFormSectionSchema = z.strictObject({
  key: z.string().max(64).regex(sectionKeyRe),
  keys: z.array(z.string().max(64).regex(fieldKeyRe)).readonly(),
});

/** The data half of {@link AdminFormDeclaration}. That every key is a field of its set is composition's (`unknown-field`). */
export const AdminFormDeclarationSchema = z
  .strictObject({
    id: z.string().max(128).regex(adminFormIdRe),
    fieldSet: z.string().max(64).regex(fieldSetIdRe),
    mode: z.enum(['create', 'edit']),
    sections: z.array(AdminFormSectionSchema).min(1).readonly(),
  })
  .superRefine((form, ctx) => {
    if (!form.id.startsWith(`${form.fieldSet}.`)) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: `Form id '${form.id}' must be '${form.fieldSet}.<form>'.` });
    }
    const sections = new Set<string>();
    const keys = new Set<string>();
    for (const [index, section] of form.sections.entries()) {
      if (sections.has(section.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', index, 'key'],
          message: `duplicate-section: section '${section.key}' is declared twice in form '${form.id}'.`,
        });
      }
      sections.add(section.key);
      for (const key of section.keys) {
        if (keys.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['sections', index, 'keys'],
            message: `duplicate-form-key: '${key}' is shown twice in form '${form.id}'; a key appears in at most one section.`,
          });
        }
        keys.add(key);
      }
    }
  });

function refuseInvalid(schema: z.ZodType, value: unknown, what: string): void {
  const parsed = schema.safeParse(value);
  if (parsed.success) return;
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
  throw new Error(`[contracts/admin-forms] ${what} is invalid — ${issues}`);
}

/**
 * Declare a field set. Identity with validation: the literal types are kept, so
 * a form, an anchor or a renderer naming an unknown key is a type error, and a
 * declaration the schema refuses throws at import time.
 */
export function defineFieldSet<const F extends FieldSetDeclaration>(f: F): F {
  refuseInvalid(FieldSetDeclarationSchema, f, `field set "${String(f.id)}"`);
  return f;
}

/** Declare an admin form over a field set. Identity with validation, as {@link defineFieldSet}. */
export function defineAdminForm<const F extends AdminFormDeclaration>(f: F): F {
  refuseInvalid(AdminFormDeclarationSchema, f, `admin form "${String(f.id)}"`);
  return f;
}

// ---------------------------------------------------------------------------
// Tightening and overrides (`field-rules.md` §1, `field-overrides.md` §1)
// ---------------------------------------------------------------------------

/**
 * A narrowing of a field's core rules. Admitted only as a narrowing
 * (`override-loosens-rule`, composition); several modules' tightenings on one
 * field merge by conjunction.
 */
export const FieldValidationTighteningSchema = z.strictObject({
  required: z.literal(true).optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /** ECMAScript source, compiled with the `u` flag on both ends. */
  pattern: z
    .string()
    .max(256)
    .refine((source) => {
      try {
        new RegExp(source, 'u');
        return true;
      } catch {
        return false;
      }
    }, 'The pattern does not compile as an ECMAScript regular expression with the u flag.')
    .optional(),
  options: z.array(z.string().min(1)).min(1).readonly().optional(),
  /** A {@link FIELD_FORMATS} id or a module format; usually implied by a control. */
  format: z.string().optional(),
  /** Per-rule message key in the declaring module's bundle; default: the platform sentence. */
  messageKey: translationKey.optional(),
});
export type FieldValidationTightening = z.infer<typeof FieldValidationTighteningSchema>;

/** At most this many overrides per manifest. */
export const MAX_FORM_OVERRIDES_PER_MODULE = 200;

/**
 * One deployment override of one field (`field-overrides.md` §1). Each present
 * property is one override kind — see {@link fieldOverrideKinds}. Strict, so a
 * mistyped property is refused rather than silently stripped.
 */
export const FieldOverrideSchema = z
  .strictObject({
    target: z.string().max(160).regex(fieldTargetRe),
    /** Presentation only: narrow to these forms. Server-enforced kinds ignore it (entity-level). */
    forms: z.array(z.string().max(128).regex(adminFormIdRe)).min(1).readonly().optional(),
    labelKey: translationKey.optional(),
    helpKey: translationKey.optional(),
    placeholderKey: translationKey.optional(),
    position: z
      .strictObject({
        section: z.string().regex(sectionKeyRe).optional(),
        before: z.string().regex(fieldReferenceRe).optional(),
        after: z.string().regex(fieldReferenceRe).optional(),
      })
      .optional(),
    /** Parsed against the field type at composition. */
    default: z.unknown().optional(),
    readOnly: z.boolean().optional(),
    hidden: z.literal(true).optional(),
    control: z.string().regex(inputControlIdRe).optional(),
    visibleWhen: FieldConditionSchema.optional(),
    validation: FieldValidationTighteningSchema.optional(),
    requiredWhen: FieldConditionSchema.optional(),
    writePermission: permissionCode.optional(),
    /** A mask paired with a server pattern, declared so the report can say which masks bind. */
    maskEnforced: z.boolean().optional(),
    /** The deployment's sentence for the divergence report. */
    reason: z.string().min(1).max(280),
  })
  .superRefine((override, ctx) => {
    const position = override.position;
    if (position !== undefined) {
      if (position.before !== undefined && position.after !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['position'], message: 'A position names at most one of before and after.' });
      }
      if (position.section === undefined && position.before === undefined && position.after === undefined) {
        ctx.addIssue({ code: 'custom', path: ['position'], message: 'A position names a section, a before or an after.' });
      }
    }
    if (fieldOverrideKinds(override).length === 0) {
      ctx.addIssue({ code: 'custom', message: `The override of '${override.target}' sets no override kind.` });
    }
  });
export type FieldOverride = z.infer<typeof FieldOverrideSchema>;

const OVERRIDE_PROPERTY_KINDS: readonly (readonly [keyof FieldOverride, FieldOverrideKind])[] = [
  ['labelKey', 'label'],
  ['helpKey', 'help'],
  ['placeholderKey', 'placeholder'],
  ['position', 'position'],
  ['default', 'default'],
  ['readOnly', 'readOnly'],
  ['hidden', 'hidden'],
  ['control', 'control'],
  ['maskEnforced', 'behaviour'],
  ['visibleWhen', 'visibleWhen'],
  ['validation', 'validation'],
  ['requiredWhen', 'requiredWhen'],
  ['writePermission', 'writePermission'],
];

/**
 * The override kinds an override sets, in {@link FIELD_OVERRIDE_KINDS} order:
 * `labelKey` → `label`, `helpKey` → `help`, `placeholderKey` → `placeholder`,
 * `maskEnforced` → `behaviour`, every other property its own name. One mapping
 * for composition, the divergence derivation and the admin.
 */
export function fieldOverrideKinds(override: Partial<Record<keyof FieldOverride, unknown>>): FieldOverrideKind[] {
  const kinds = new Set<FieldOverrideKind>();
  for (const [property, kind] of OVERRIDE_PROPERTY_KINDS) {
    if (override[property] !== undefined) kinds.add(kind);
  }
  return FIELD_OVERRIDE_KINDS.filter((kind) => kinds.has(kind));
}

/** One entry of `422 FIELD_RULE_VIOLATION`'s `details` (`field-rules.md` §5). */
export const FieldRuleViolationDetailSchema = z.object({
  /** A core key, or `extensions.<moduleId>.<key>` for a slot. */
  path: z.string(),
  code: z.enum(FIELD_RULE_CODES),
  params: z.object({ limit: z.number().optional(), format: z.string().optional() }).optional(),
  /** In the request's language; the declaring module's `messageKey` sentence when one is declared. */
  message: z.string(),
});
export type FieldRuleViolationDetail = z.infer<typeof FieldRuleViolationDetailSchema>;

// ---------------------------------------------------------------------------
// Input controls (`input-controls.md` §1)
// ---------------------------------------------------------------------------

export const InputControlDeclarationSchema = z.strictObject({
  id: z.string().max(96).regex(inputControlIdRe),
  outputType: z.enum(FIELD_VALUE_TYPES),
  format: z
    .string()
    .refine(
      (format) => (FIELD_FORMATS as readonly string[]).includes(format) || moduleFieldFormatRe.test(format),
      'A format is a platform format or a module format <moduleId>.<name>.',
    )
    .optional(),
  /** For select-like controls: the control lists the field's options (implies an options subset). */
  optionsFromField: z.boolean().optional(),
});
export type InputControlDeclaration = z.infer<typeof InputControlDeclarationSchema>;

/** The data half of the admin-kit's controls. Ids and output types are stable identity. */
export const PLATFORM_INPUT_CONTROLS = [
  { id: 'platform.text', outputType: 'string' },
  { id: 'platform.textarea', outputType: 'string' },
  { id: 'platform.email', outputType: 'string', format: 'email' },
  { id: 'platform.tel', outputType: 'string', format: 'tel' },
  { id: 'platform.url', outputType: 'string', format: 'url' },
  { id: 'platform.number', outputType: 'decimal' },
  { id: 'platform.integer', outputType: 'integer' },
  { id: 'platform.decimal', outputType: 'decimal' },
  { id: 'platform.switch', outputType: 'boolean' },
  { id: 'platform.select', outputType: 'enum', optionsFromField: true },
  { id: 'platform.multiselect', outputType: 'enum[]', optionsFromField: true },
  { id: 'platform.date', outputType: 'date' },
  { id: 'platform.country', outputType: 'string', format: 'country' },
  { id: 'platform.color', outputType: 'string', format: 'color' },
] as const satisfies readonly InputControlDeclaration[];
export type PlatformInputControlId = (typeof PLATFORM_INPUT_CONTROLS)[number]['id'];

// ---------------------------------------------------------------------------
// Admin contributions: slots, controls, behaviours (`field-slots.md` §1 – §2,
// `input-controls.md` §1, `field-rules.md` §4)
// ---------------------------------------------------------------------------

/** The data half of a slot field a module adds to another module's form. */
export const AdminFieldContributionSchema = z.object({
  fieldSet: z.string().max(64).regex(fieldSetIdRe),
  /** Default: every form of the set. */
  forms: z.array(z.string().max(128).regex(adminFormIdRe)).min(1).readonly().optional(),
  /** Module-local; the wire key is `<moduleId>.<key>`, and the module id is never declared (D-142). */
  key: z.string().regex(slotFieldKeyRe),
  type: z.enum(FIELD_VALUE_TYPES),
  anchor: z.union([
    z.strictObject({ field: z.string().regex(fieldReferenceRe), position: z.enum(['before', 'after']) }),
    z.strictObject({ section: z.string().regex(sectionKeyRe), position: z.enum(['start', 'end']) }),
  ]),
  weight: z.number().int(),
  /** In the contributor's own bundle. */
  labelKey: translationKey,
  helpKey: translationKey.optional(),
  /** Render gate. */
  requiredPermission: PermissionRequirementSchema.optional(),
  /** Enforced by the platform's `fieldSlotHook`. */
  writePermission: permissionCode.optional(),
  /** Shown only when true; same vocabulary as overrides. */
  visibleWhen: FieldConditionSchema.optional(),
});

export interface AdminFieldContribution extends z.infer<typeof AdminFieldContributionSchema> {
  /** Default export: `ComponentType<FieldSlotProps<T>>`. */
  readonly component: AdminComponentFactory;
}

/**
 * What the kit's `FormField` puts on its control — the structural twin of
 * admin-kit's `FormFieldControlProps`, which this package cannot import.
 */
export interface FieldSlotControlProps {
  readonly id: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
  readonly 'aria-required'?: true;
}

/** The props a slot field's component receives (`field-slots.md` §2). It renders the input only. */
export interface FieldSlotProps<T = unknown> {
  readonly formId: string;
  readonly mode: 'create' | 'edit';
  /** `null` on create. */
  readonly recordId: string | null;
  /** From the host read's `extensions.<moduleId>.<key>`. */
  readonly value: T | undefined;
  readonly onChange: (next: T | undefined) => void;
  /** Host read-only, or the operator lacks the slot's `writePermission`. */
  readonly readOnly: boolean;
  /** Mapped from the `extensions.<moduleId>.<key>` error details. */
  readonly error: string | undefined;
  readonly control: FieldSlotControlProps;
  /** Read-only view of the form's current core values. */
  readonly formValues: Readonly<Record<string, unknown>>;
}

/** The data half of a module's input control component; its declaration is the manifest's `inputControls`. */
export const AdminInputControlContributionSchema = z.object({
  id: z.string().max(96).regex(inputControlIdRe),
});

export interface AdminInputControlContribution extends z.infer<typeof AdminInputControlContributionSchema> {
  readonly component: AdminComponentFactory;
}

/** The data half of a mask or derivation (UI only; the server never runs it). */
export const AdminFieldBehaviourSchema = z.object({
  /** `<fieldSet>.<key>` or `<fieldSet>.<ownModuleId>.<key>`. */
  target: z.string().max(160).regex(fieldTargetRe),
  forms: z.array(z.string().max(128).regex(adminFormIdRe)).min(1).readonly().optional(),
});

export interface AdminFieldBehaviour extends z.infer<typeof AdminFieldBehaviourSchema> {
  /**
   * Default export: `{ mask?: (raw: string) => string; derive?: { from: readonly string[];
   * compute: (values) => unknown } }`.
   */
  readonly behaviour: AdminComponentFactory;
}

// ---------------------------------------------------------------------------
// Effective forms (`field-overrides.md` §2) — `GET /api/v1/admin/forms`
// ---------------------------------------------------------------------------

/** The origins as `MODULE_ORIGINS` states them; a type import, so this file adds no import cycle. */
const EFFECTIVE_ORIGINS = ['core', 'deployment', 'package'] as const satisfies readonly ModuleOrigin[];
type MissingOrigin = Exclude<ModuleOrigin, (typeof EFFECTIVE_ORIGINS)[number]>;
const everyOriginListed: [MissingOrigin] extends [never] ? true : never = true;
void everyOriginListed;

/** A code layer names a bundle key; the operator layer carries per-language text. The admin picks the reader's language. */
export const EffectiveTextSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('code'), module: z.string(), key: z.string() }),
  z.object({ source: z.literal('operator'), text: z.record(z.string(), z.string()) }),
]);
export type EffectiveText = z.infer<typeof EffectiveTextSchema>;

export const EffectiveFieldSchema = z.object({
  key: z.string(),
  label: EffectiveTextSchema.optional(),
  help: EffectiveTextSchema.optional(),
  placeholder: EffectiveTextSchema.optional(),
  /** Post-position, per form. */
  section: z.string(),
  order: z.number().int(),
  default: z.unknown().optional(),
  readOnly: z.boolean(),
  hidden: z.boolean(),
  /** `null`: the host's own renderer. */
  control: z.string().nullable(),
  visibleWhen: FieldConditionSchema.optional(),
  /** The merged conjunction. */
  validation: FieldValidationTighteningSchema.optional(),
  requiredWhen: FieldConditionSchema.optional(),
  /** Effective: the owner's or the deployment's. */
  writePermission: z.string().optional(),
  overriddenBy: z.array(z.object({ module: z.string(), origin: z.enum(EFFECTIVE_ORIGINS), kinds: z.array(z.string()) })),
  /** Kinds the operator layer set on this field. */
  operatorKinds: z.array(z.string()),
});
export type EffectiveField = z.infer<typeof EffectiveFieldSchema>;

export const EffectiveFormsResponseSchema = z.object({
  forms: z.array(z.object({ id: z.string(), fieldSet: z.string(), fields: z.array(EffectiveFieldSchema) })),
});
export type EffectiveFormsResponse = z.infer<typeof EffectiveFormsResponseSchema>;

// ---------------------------------------------------------------------------
// Operator layer port (`operator-form-layout.md` §1, §4)
// ---------------------------------------------------------------------------

/** One `custom_field_form_layout_overrides` row, as stored. Texts are `{ <language>: text }`. */
export interface FormLayoutOverrideRow {
  readonly id: string;
  readonly formId: string;
  /** A core key, a family member (`attributeValues.color`) or a slot `<moduleId>.<key>`. */
  readonly fieldKey: string;
  readonly labels: Readonly<Record<string, string>> | null;
  readonly helps: Readonly<Record<string, string>> | null;
  readonly placeholders: Readonly<Record<string, string>> | null;
  readonly section: string | null;
  readonly before: string | null;
  readonly after: string | null;
  readonly hidden: boolean;
  readonly readOnly: boolean;
  readonly version: number;
  readonly updatedAt: Date;
}

/**
 * The operator layer of the effective forms, provided by `custom_fields` under
 * the container name `formLayoutOverrideSource`.
 *
 * **Not yet a published port.** `check:port-shape` refuses a port marker that
 * nothing registers, and `custom_fields` registers this one in a later work
 * package of `specs/193-admin-form-extensions/`; that change adds the marker
 * line (container name and owner) to this block, with the registration. The platform's `FormRegistry`
 * resolves it lazily and applies the layering itself
 * (`operator-form-layout.md` §3); the provider keeps an in-process cache with
 * a 60-second TTL and drops it on {@link FORM_LAYOUT_CHANGED_CHANNEL}.
 *
 * **Owner off:** not reachable — `custom_fields` is non-deactivatable. A
 * composition without the port has an empty operator layer, and the forms fail
 * open to code and core, which affects presentation only.
 */
export interface FormLayoutOverrideSource {
  /** Every row, as stored. */
  listAll(): Promise<readonly FormLayoutOverrideRow[]>;
}

/**
 * Announced after every committed `custom_fields.form_layout.set`, `.reset` and
 * `.rekey`, with a {@link FormLayoutChangedMessage}. Every process drops its
 * cache and bumps the effective-forms generation (R-18).
 */
export const FORM_LAYOUT_CHANGED_CHANNEL = 'b2b:form-layout:changed';

export interface FormLayoutChangedMessage {
  readonly formId: string;
}

// ---------------------------------------------------------------------------
// The rules one manifest decides (`defineModuleManifest`)
// ---------------------------------------------------------------------------

/**
 * What `defineModuleManifest` can refuse from one manifest: a field set owned by
 * another module, one field set or form declared twice, and an input control
 * outside the module's namespace or declared twice. Duplicates **across**
 * manifests, unknown fields, grants and dependencies are composition's.
 */
export function assertAdminFormManifestRules(m: {
  readonly id: string;
  readonly fieldSets?: readonly { readonly id: string; readonly ownerModuleId: string }[] | undefined;
  readonly adminForms?: readonly { readonly id: string }[] | undefined;
  readonly inputControls?: readonly { readonly id: string }[] | undefined;
}): void {
  const sets = new Set<string>();
  for (const set of m.fieldSets ?? []) {
    if (set.ownerModuleId !== m.id) {
      throw new Error(
        `[contracts/admin-forms] manifest "${m.id}" declares field set "${set.id}" owned by "${set.ownerModuleId}". ` +
          'Only the owner of the host declares its field set; another module declares a form over it (adminForms) or a slot.',
      );
    }
    if (sets.has(set.id)) {
      throw new Error(`[contracts/admin-forms] manifest "${m.id}" (duplicate-field-set) declares field set "${set.id}" twice.`);
    }
    sets.add(set.id);
  }
  const forms = new Set<string>();
  for (const form of m.adminForms ?? []) {
    if (forms.has(form.id)) {
      throw new Error(`[contracts/admin-forms] manifest "${m.id}" (duplicate-form) declares form "${form.id}" twice.`);
    }
    forms.add(form.id);
  }
  const controls = new Set<string>();
  for (const control of m.inputControls ?? []) {
    if (!control.id.startsWith(`${m.id}.`)) {
      throw new Error(
        `[contracts/admin-forms] manifest "${m.id}" declares input control "${control.id}" outside its namespace; ` +
          `name it "${m.id}.<name>" ("platform." is the admin-kit's).`,
      );
    }
    if (controls.has(control.id)) {
      throw new Error(`[contracts/admin-forms] manifest "${m.id}" declares input control "${control.id}" twice.`);
    }
    controls.add(control.id);
  }
}
