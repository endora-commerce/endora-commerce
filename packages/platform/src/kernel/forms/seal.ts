import {
  FieldConditionSchema,
  PLATFORM_INPUT_CONTROLS,
  SERVER_ENFORCED_OVERRIDES,
  fieldOverrideKinds,
  type AdminFormDeclaration,
  type FieldCondition,
  type FieldDeclaration,
  type FieldOverride,
  type FieldOverrideKind,
  type FieldSetDeclaration,
  type FieldValidationTightening,
  type FieldValueType,
  type InputControlDeclaration,
  type ModuleOrigin,
} from '@endora-commerce/contracts';
import type { HookableActionOwnership } from '../../commands/hooks/registry.js';
import {
  FormCompositionError,
  InvalidFormOverrideGrantError,
  PackageFormOverrideNotGrantedError,
  type FormCompositionWarning,
} from './errors.js';
import { isPlatformFormat } from './formats.js';
import { byCodePoint, contradictionOf, mergeValidation, type MergedValidation } from './rules.js';
import type { FieldFormatRegistration, FieldSetWriter } from './types.js';

/**
 * `FormRegistry.seal` (`specs/193-admin-form-extensions/` FR-021, FR-051,
 * `contracts/field-overrides.md` §3): every composed declaration of a field
 * set, form, override, input control, writer and format is judged against
 * every other, once, before the first boot hook. What one declaration can
 * decide alone was refused by contracts at definition time; this is what needs
 * the whole composition — the other manifests, the origins, the grants, the
 * dependency closure, the permission vocabulary and the writers.
 *
 * Pure and deterministic: inputs are sorted where order could matter, so the
 * same composition seals to the same model — and refuses with the same error —
 * whatever order the modules registered in.
 */

/** What the root derives from the manifests (`formCompositionFrom`). */
export interface FormDeclarationsInput {
  readonly fieldSets: readonly { readonly moduleId: string; readonly set: FieldSetDeclaration }[];
  readonly adminForms: readonly { readonly moduleId: string; readonly form: AdminFormDeclaration }[];
  readonly formOverrides: readonly { readonly moduleId: string; readonly override: FieldOverride }[];
  readonly inputControls: readonly { readonly moduleId: string; readonly control: InputControlDeclaration }[];
  /** Every composed module's `hookableActions`, with its owner. */
  readonly hookableActions: readonly HookableActionOwnership[];
  /** Each module's transitive manifest dependencies. */
  readonly moduleDependencies: Readonly<Record<string, readonly string[]>>;
  /** Every permission code a composed manifest declares. */
  readonly permissionCodes: readonly string[];
  /** The deployment's `formOverrideGrants`, from its `divergence.ts`. */
  readonly formOverrideGrants?: Readonly<Record<string, readonly { readonly moduleId: string; readonly packageName: string; readonly reason: string }[]>> | undefined;
}

/** {@link FormDeclarationsInput}, plus what only the composer and the modules' registrations supply. */
export interface FormSealInput extends FormDeclarationsInput {
  /** Each composed module's origin, derived by the composer (189 `module-origin.md` §2). */
  readonly origins: Readonly<Record<string, ModuleOrigin>>;
  /** The installed package name of each `package` module. */
  readonly installedPackageNames: Readonly<Record<string, string>>;
  /** `ctx.fieldSets` registrations. */
  readonly writers: readonly { readonly moduleId: string; readonly set: FieldSetDeclaration; readonly writers: readonly FieldSetWriter[] }[];
  /** `ctx.fieldFormats` registrations. */
  readonly formats: readonly ({ readonly moduleId: string } & FieldFormatRegistration)[];
}

/** One override, resolved against its field set. */
export interface SealedOverride {
  readonly moduleId: string;
  readonly origin: ModuleOrigin;
  readonly override: FieldOverride;
  /** The live key (an alias resolved) or the family member it targets. */
  readonly fieldKey: string;
  readonly field: FieldDeclaration;
  /** The forms its presentation kinds apply to: `forms`, or every form of the set that shows the field. */
  readonly forms: readonly string[];
  readonly kinds: readonly FieldOverrideKind[];
  /** The module of its `control`, when the control is a module's (`null` for a platform control). */
  readonly controlModuleId: string | null;
}

/**
 * One module's server-enforced contribution to one field: what the field-rule
 * check holds a write to while every module in `requires` is present.
 */
export interface RuleContribution {
  readonly moduleId: string;
  /** The declaring module, and the module of a format it relies on. */
  readonly requires: readonly string[];
  readonly validation?: FieldValidationTightening | undefined;
  readonly requiredWhen?: FieldCondition | undefined;
  readonly writePermission?: string | undefined;
}

export interface SealedForm {
  readonly id: string;
  readonly moduleId: string;
  readonly fieldSet: string;
  readonly mode: 'create' | 'edit';
  readonly sections: AdminFormDeclaration['sections'];
}

export interface SealedFieldSet {
  readonly id: string;
  readonly ownerModuleId: string;
  readonly set: FieldSetDeclaration;
  readonly forms: readonly SealedForm[];
  /** In (module id, target) order. */
  readonly overrides: readonly SealedOverride[];
  /** Field key → contributions, in module-id order. Family members are their own keys. */
  readonly rules: ReadonlyMap<string, readonly RuleContribution[]>;
  /** Field key → the owner's own `writePermission`. */
  readonly ownerWritePermissions: ReadonlyMap<string, string>;
  /** Resolve a key — live, alias or family member — to its declaration. */
  field(key: string): FieldDeclaration | undefined;
}

export interface SealedWriter {
  readonly set: SealedFieldSet;
  readonly writer: FieldSetWriter;
}

export interface SealedForms {
  readonly fieldSets: ReadonlyMap<string, SealedFieldSet>;
  /** Every form, in (field set, declaration) order. */
  readonly forms: readonly SealedForm[];
  readonly writersByAction: ReadonlyMap<string, readonly SealedWriter[]>;
  /** Control id → its declaring module (`null` for a platform control) and declaration. */
  readonly controls: ReadonlyMap<string, { readonly moduleId: string | null; readonly control: InputControlDeclaration }>;
  /** Module format id → its registering module and validator. */
  readonly formats: ReadonlyMap<string, { readonly moduleId: string; readonly validate: (value: string) => boolean }>;
  readonly warnings: readonly FormCompositionWarning[];
}

const byModule = <T extends { readonly moduleId: string }>(a: T, b: T): number => byCodePoint(a.moduleId, b.moduleId);

interface ResolvedKey {
  readonly field: FieldDeclaration;
  /** The key the rest of the platform uses: the live key, or the family member. */
  readonly key: string;
  readonly alias: boolean;
}

function keyResolver(set: FieldSetDeclaration): (key: string) => ResolvedKey | undefined {
  const live = new Map<string, FieldDeclaration>();
  const aliases = new Map<string, FieldDeclaration>();
  const families = new Map<string, FieldDeclaration>();
  for (const field of set.fields) {
    live.set(field.key, field);
    if (field.key.endsWith('.*')) families.set(field.key.slice(0, -2), field);
    for (const alias of field.deprecatedAliases ?? []) aliases.set(alias.key, field);
  }
  return (key) => {
    const field = live.get(key);
    if (field !== undefined) return { field, key, alias: false };
    const aliased = aliases.get(key);
    if (aliased !== undefined) return { field: aliased, key: aliased.key, alias: true };
    const dot = key.indexOf('.');
    if (dot > 0 && !key.endsWith('.*')) {
      const family = families.get(key.slice(0, dot));
      if (family !== undefined) return { field: family, key, alias: false };
    }
    return undefined;
  };
}

/** Every key a form shows, in section order. */
function formKeys(form: SealedForm): string[] {
  return form.sections.flatMap((section) => [...section.keys]);
}

function sectionOf(form: SealedForm, key: string): string | undefined {
  return form.sections.find((section) => section.keys.includes(key))?.key;
}

/** A value the field's type can hold (a `default`). */
function holdsType(field: FieldDeclaration, value: unknown): boolean {
  const scalar = (type: FieldValueType, element: unknown): boolean => {
    switch (type) {
      case 'string':
      case 'reference':
        return typeof element === 'string';
      case 'integer':
        return typeof element === 'number' && Number.isInteger(element);
      case 'decimal':
        return (typeof element === 'number' && Number.isFinite(element)) || (typeof element === 'string' && /^-?\d+(\.\d+)?$/u.test(element));
      case 'boolean':
        return typeof element === 'boolean';
      case 'date':
        return typeof element === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(element);
      case 'datetime':
        return typeof element === 'string' && !Number.isNaN(Date.parse(element));
      case 'enum':
        return typeof element === 'string' && (field.options ?? []).includes(element);
      default:
        return false;
    }
  };
  if (field.type === 'composite') return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (field.type.endsWith('[]')) {
    const element = field.type.slice(0, -2) as FieldValueType;
    return Array.isArray(value) && value.every((member) => scalar(element, member));
  }
  return scalar(field.type, value);
}

function conditionFields(condition: FieldCondition): string[] {
  if ('all' in condition) return condition.all.flatMap(conditionFields);
  if ('any' in condition) return condition.any.flatMap(conditionFields);
  if ('not' in condition) return conditionFields(condition.not);
  return [condition.field];
}

const STRINGISH: ReadonlySet<FieldValueType> = new Set(['string', 'string[]']);
const NUMERIC: ReadonlySet<FieldValueType> = new Set(['integer', 'decimal']);

/** Why a tightening is not a narrowing of `field`'s core rules, or `null`. */
function looseningOf(field: FieldDeclaration, validation: FieldValidationTightening): string | null {
  const bounds = field.bounds ?? {};
  if (validation.required === true && field.required) return `'required' on a field core already requires`;
  if ((validation.minLength !== undefined || validation.maxLength !== undefined) && !STRINGISH.has(field.type)) {
    return `a length bound on a ${field.type} field`;
  }
  if ((validation.min !== undefined || validation.max !== undefined) && !NUMERIC.has(field.type)) {
    return `a numeric bound on a ${field.type} field`;
  }
  if ((validation.pattern !== undefined || validation.format !== undefined) && !STRINGISH.has(field.type)) {
    return `a pattern or format on a ${field.type} field`;
  }
  if (validation.minLength !== undefined && bounds.minLength !== undefined && validation.minLength < bounds.minLength) {
    return `minLength ${validation.minLength} is below core's ${bounds.minLength}`;
  }
  if (validation.maxLength !== undefined && bounds.maxLength !== undefined && validation.maxLength > bounds.maxLength) {
    return `maxLength ${validation.maxLength} is above core's ${bounds.maxLength}`;
  }
  if (validation.min !== undefined && bounds.min !== undefined && validation.min < bounds.min) return `min ${validation.min} is below core's ${bounds.min}`;
  if (validation.max !== undefined && bounds.max !== undefined && validation.max > bounds.max) return `max ${validation.max} is above core's ${bounds.max}`;
  if (validation.options !== undefined) {
    if (field.type === 'enum' || field.type === 'enum[]') {
      const outside = validation.options.filter((option) => !(field.options ?? []).includes(option));
      if (outside.length > 0) return `options ${outside.join(', ')} are not in core's enum`;
    } else if (!STRINGISH.has(field.type)) {
      return `options on a ${field.type} field`;
    }
  }
  return null;
}

/** The fit table (`input-controls.md` §2): whether a control may replace `field`'s. */
function controlFits(field: FieldDeclaration, control: InputControlDeclaration, override: FieldOverride): boolean {
  switch (field.type) {
    case 'string':
      return control.outputType === 'string' || (control.outputType === 'enum' && control.optionsFromField === true && override.validation?.options !== undefined);
    case 'decimal':
      return control.outputType === 'decimal' || control.outputType === 'integer';
    case 'reference':
    case 'reference[]':
    case 'composite':
      return false;
    default:
      return control.outputType === field.type;
  }
}

const NON_CONFLICTING: ReadonlySet<FieldOverrideKind> = new Set(['hidden', 'readOnly']);
const SERVER_KINDS: ReadonlySet<FieldOverrideKind> = new Set(SERVER_ENFORCED_OVERRIDES);

export function sealForms(input: FormSealInput): SealedForms {
  const warnings: FormCompositionWarning[] = [];
  const dependsOn = (moduleId: string, owner: string): boolean =>
    moduleId === owner || (input.moduleDependencies[moduleId] ?? []).includes(owner);
  const permissions = new Set(input.permissionCodes);
  const originOf = (moduleId: string): ModuleOrigin => input.origins[moduleId] ?? 'core';

  // ---- Field sets and forms -------------------------------------------------
  const sets = new Map<string, { moduleId: string; set: FieldSetDeclaration; resolve: (key: string) => ResolvedKey | undefined }>();
  for (const { moduleId, set } of [...input.fieldSets].sort((a, b) => byCodePoint(a.set.id, b.set.id) || byModule(a, b))) {
    const existing = sets.get(set.id);
    if (existing !== undefined) {
      throw new FormCompositionError(
        'duplicate-field-set',
        { moduleId, fieldSet: set.id },
        `field set '${set.id}' is declared by '${existing.moduleId}' and by '${moduleId}'`,
        'A field set is one host entity’s and has one owner; another module declares a form over it (adminForms) or a slot field.',
      );
    }
    sets.set(set.id, { moduleId, set, resolve: keyResolver(set) });
  }

  const formsById = new Map<string, SealedForm>();
  for (const { moduleId, form } of input.adminForms) {
    const existing = formsById.get(form.id);
    if (existing !== undefined) {
      throw new FormCompositionError(
        'duplicate-form',
        { moduleId, fieldSet: form.fieldSet },
        `form '${form.id}' is declared by '${existing.moduleId}' and by '${moduleId}'`,
        'A form id is frozen identity and has one declaring module; give the second form its own id.',
      );
    }
    const owner = sets.get(form.fieldSet);
    if (owner === undefined) {
      throw new FormCompositionError(
        'unknown-field-set',
        { moduleId, fieldSet: form.fieldSet },
        `form '${form.id}' lays out field set '${form.fieldSet}', which no composed module declares`,
        'Declare the field set in its owner’s manifest (fieldSets), or depend on the module that does.',
      );
    }
    if (!dependsOn(moduleId, owner.moduleId)) {
      throw new FormCompositionError(
        'form-owner-not-a-dependency',
        { moduleId, fieldSet: form.fieldSet },
        `form '${form.id}' is declared by a module that does not depend on '${owner.moduleId}', the field set’s owner`,
        `Add '${owner.moduleId}' to the manifest’s dependencies (FR-083).`,
      );
    }
    for (const key of form.sections.flatMap((section) => section.keys)) {
      const resolved = owner.resolve(key);
      if (resolved === undefined || resolved.alias) {
        throw new FormCompositionError(
          'unknown-field',
          { moduleId, fieldSet: form.fieldSet, field: key },
          `form '${form.id}' shows '${key}', which is not a live key of the field set`,
          'Show a declared key of the field set; a renamed key is shown under its new name.',
        );
      }
    }
    formsById.set(form.id, { id: form.id, moduleId, fieldSet: form.fieldSet, mode: form.mode, sections: form.sections });
  }
  const formsOf = (setId: string): SealedForm[] => [...formsById.values()].filter((form) => form.fieldSet === setId);

  // ---- Controls and formats -------------------------------------------------
  const controls = new Map<string, { moduleId: string | null; control: InputControlDeclaration }>();
  for (const control of PLATFORM_INPUT_CONTROLS) controls.set(control.id, { moduleId: null, control });
  for (const { moduleId, control } of input.inputControls) controls.set(control.id, { moduleId, control });

  const formats = new Map<string, { moduleId: string; validate: (value: string) => boolean }>();
  for (const format of input.formats) {
    if (!format.id.startsWith(`${format.moduleId}.`)) {
      throw new FormCompositionError(
        'foreign-field-format',
        { moduleId: format.moduleId },
        `ctx.fieldFormats registers '${format.id}' outside the module’s namespace`,
        `Name the format '${format.moduleId}.<name>'; the platform formats are the platform’s.`,
      );
    }
    if (formats.has(format.id)) {
      throw new FormCompositionError(
        'duplicate-field-format',
        { moduleId: format.moduleId },
        `format '${format.id}' is registered twice`,
        'Register each format once, from the module’s registerModule.',
      );
    }
    formats.set(format.id, { moduleId: format.moduleId, validate: format.validate });
  }
  const formatOwner = (format: string): string | null | undefined =>
    isPlatformFormat(format) ? null : formats.get(format)?.moduleId;

  // ---- Writers (owner side, field-rules.md §2) --------------------------------
  const declarations = new Map(input.hookableActions.map((declaration) => [declaration.action, declaration]));
  const registered = new Map<string, readonly FieldSetWriter[]>();
  for (const { moduleId, set, writers } of input.writers) {
    const declared = sets.get(set.id);
    if (declared === undefined) {
      throw new FormCompositionError(
        'unknown-field-set',
        { moduleId, fieldSet: set.id },
        `ctx.fieldSets registers writers for '${set.id}', which no manifest declares`,
        'Declare the field set in this module’s manifest (fieldSets) and register that constant.',
      );
    }
    if (declared.moduleId !== moduleId) {
      throw new FormCompositionError(
        'foreign-field-set-registration',
        { moduleId, fieldSet: set.id },
        `ctx.fieldSets registers writers for a field set owned by '${declared.moduleId}'`,
        'Only the owner lists the writers of its entity; a slot module writes through fieldSlotHook on those writers.',
      );
    }
    if (registered.has(set.id)) {
      throw new FormCompositionError(
        'duplicate-field-set-registration',
        { moduleId, fieldSet: set.id },
        'the field set is registered with ctx.fieldSets twice',
        'Register each field set once, with every writer in one entry.',
      );
    }
    for (const writer of writers) {
      const action = writer.on.action;
      const declaration = declarations.get(action);
      if (writer.ruleCheckOnly === true) {
        if (declaration !== undefined) {
          throw new FormCompositionError(
            'rule-check-only-writer-hookable',
            { moduleId, fieldSet: set.id },
            `writer '${action}' is rule-check-only, and '${declaration.moduleId}' declares it hookable`,
            'A write a stored-revert undo reverses runs under an action of its own that is never hookable (FR-113): rename the action, or drop ruleCheckOnly.',
          );
        }
      } else if (declaration === undefined || !declaration.phases.includes('beforeCommit')) {
        throw new FormCompositionError(
          'writer-not-hookable',
          { moduleId, fieldSet: set.id },
          `writer '${action}' is not a hookable action offering beforeCommit`,
          'Declare the action in the manifest’s hookableActions with beforeCommit, or — for a write an undo reverses — register it with ruleCheckOnly: true (FR-081, FR-113).',
        );
      }
      for (const key of writer.writes) {
        const resolved = declared.resolve(key);
        if (resolved === undefined || resolved.alias) {
          throw new FormCompositionError(
            'unknown-field',
            { moduleId, fieldSet: set.id, field: key },
            `writer '${action}' lists '${key}' in writes, which is not a key of the field set`,
            'List the live keys the writer changes and projects.',
          );
        }
      }
    }
    registered.set(set.id, writers);
  }

  const writesKey = (setId: string, key: string): boolean =>
    (registered.get(setId) ?? []).some((writer) =>
      writer.writes.some((written) => written === key || (key.endsWith('.*') && written.startsWith(key.slice(0, -1)))),
    );

  for (const { moduleId, set } of sets.values()) {
    for (const field of set.fields) {
      if (field.writePermission !== undefined && !permissions.has(field.writePermission)) {
        throw new FormCompositionError(
          'unknown-permission',
          { moduleId, fieldSet: set.id, field: field.key },
          `writePermission '${field.writePermission}' is not a permission any composed manifest declares`,
          'Declare the permission in the owner’s manifest (permissions), or name a declared one.',
        );
      }
      const enforced = field.accepts.some((kind) => SERVER_KINDS.has(kind)) || field.writePermission !== undefined;
      if (enforced && !writesKey(set.id, field.key)) {
        throw new FormCompositionError(
          'accepts-unenforceable',
          { moduleId, fieldSet: set.id, field: field.key },
          'the field accepts a server-enforced kind (validation, requiredWhen, writePermission), or declares a writePermission, and no registered writer writes it',
          'List the field in the writes of every writer that changes it, with a projection that returns it, or narrow accepts to presentation kinds.',
        );
      }
    }
  }

  // ---- Grants (field-overrides.md §4) -----------------------------------------
  const grants = input.formOverrideGrants ?? {};
  const grantedTo = new Map<string, Set<string>>();
  for (const [setId, entries] of Object.entries(grants).sort(([a], [b]) => byCodePoint(a, b))) {
    for (const grant of entries) {
      if (!sets.has(setId)) {
        throw new InvalidFormOverrideGrantError('unknown-field-set', grant.moduleId, setId, `no composed module declares field set '${setId}'`);
      }
      if (input.origins[grant.moduleId] === undefined) {
        throw new InvalidFormOverrideGrantError('unknown-module', grant.moduleId, setId, `'${grant.moduleId}' is not composed in this deployment`);
      }
      if (originOf(grant.moduleId) !== 'package') {
        throw new InvalidFormOverrideGrantError('not-a-package', grant.moduleId, setId, `'${grant.moduleId}' is of origin '${originOf(grant.moduleId)}'`);
      }
      const installed = input.installedPackageNames[grant.moduleId];
      if (installed !== grant.packageName) {
        throw new InvalidFormOverrideGrantError(
          'package-name-mismatch',
          grant.moduleId,
          setId,
          `the grant names '${grant.packageName}', and the installed package is '${installed ?? '(unknown)'}'`,
        );
      }
      const used = input.formOverrides.some(
        ({ moduleId, override }) => moduleId === grant.moduleId && override.target.startsWith(`${setId}.`),
      );
      if (!used) {
        throw new InvalidFormOverrideGrantError('unused', grant.moduleId, setId, `no override of '${grant.moduleId}' targets '${setId}'`);
      }
      const granted = grantedTo.get(setId) ?? new Set<string>();
      granted.add(grant.moduleId);
      grantedTo.set(setId, granted);
    }
  }

  // ---- Overrides, one at a time (field-overrides.md §3) -----------------------
  const sealedOverrides = new Map<string, SealedOverride[]>();
  const sortedOverrides = [...input.formOverrides].sort((a, b) => byModule(a, b) || byCodePoint(a.override.target, b.override.target));
  for (const { moduleId, override } of sortedOverrides) {
    const dot = override.target.indexOf('.');
    const setId = override.target.slice(0, dot);
    const targetKey = override.target.slice(dot + 1);
    const declared = sets.get(setId);
    const subject = { moduleId, fieldSet: setId, field: targetKey };
    if (declared === undefined) {
      throw new FormCompositionError(
        'unknown-field-set',
        subject,
        `the override targets '${override.target}', and no composed module declares field set '${setId}'`,
        'Target a field set a composed module declares, and depend on its owner.',
      );
    }
    const owner = declared.moduleId;
    const origin = originOf(moduleId);
    if (moduleId !== owner) {
      if (origin === 'core') {
        throw new FormCompositionError(
          'foreign-override',
          subject,
          `a core module overrides a field of '${owner}'`,
          'Core is one product: change the owner’s declaration instead. Overrides are a deployment’s, or a granted package’s (D-300.2).',
        );
      }
      if (origin === 'package' && !(grantedTo.get(setId)?.has(moduleId) ?? false)) {
        throw new PackageFormOverrideNotGrantedError(moduleId, setId, targetKey);
      }
      if (!dependsOn(moduleId, owner)) {
        throw new FormCompositionError(
          'override-owner-not-a-dependency',
          subject,
          `the overriding module does not depend on '${owner}', the field set’s owner`,
          `Add '${owner}' to the manifest’s dependencies.`,
        );
      }
    }
    const resolved = declared.resolve(targetKey);
    if (resolved === undefined) {
      throw new FormCompositionError(
        'unknown-field',
        subject,
        `'${targetKey}' is not a key of field set '${setId}'`,
        'Target a declared key (a slot field is its module’s own, not a target).',
      );
    }
    if (resolved.alias) {
      warnings.push({
        code: 'deprecated-target',
        moduleId,
        fieldSet: setId,
        field: targetKey,
        message: `[forms] deprecated-target: the override of '${moduleId}' targets '${override.target}', a deprecated alias of '${resolved.key}'; it is refused one release after the rename (FR-071). Target '${setId}.${resolved.key}'.`,
      });
    }
    const field = resolved.field;
    const fieldKey = resolved.key;
    const at = { moduleId, fieldSet: setId, field: fieldKey };
    const kinds = fieldOverrideKinds(override);

    const notAccepted = kinds.filter((kind) => !field.accepts.includes(kind));
    if (notAccepted.length > 0) {
      throw new FormCompositionError(
        'override-not-accepted',
        at,
        `the override sets ${notAccepted.join(', ')}, which the field does not accept (it accepts ${field.accepts.join(', ') || 'nothing'})`,
        'Override only what the owner invites in accepts; ask the owner to widen accepts for anything else.',
      );
    }
    if (override.hidden === true && field.required) {
      throw new FormCompositionError(
        'hidden-required-field',
        at,
        'the override hides a field core requires',
        'A required field cannot be hidden; use the replacement pattern only on an optional field.',
      );
    }
    if (override.hidden === true && override.default !== undefined) {
      throw new FormCompositionError('default-on-hidden', at, 'the override sets a default on a field it hides', 'Drop the default, or show the field.');
    }
    if (override.default !== undefined && !holdsType(field, override.default)) {
      throw new FormCompositionError(
        'default-type-mismatch',
        at,
        `the default ${JSON.stringify(override.default)} is not a ${field.type} value${field.options ? ` of ${field.options.join(', ')}` : ''}`,
        'Give a default of the field’s type.',
      );
    }

    // Forms the presentation kinds apply to.
    const showing = formsOf(setId).filter((form) => formKeys(form).includes(fieldKey));
    let forms: string[];
    if (override.forms !== undefined) {
      forms = [];
      for (const formId of override.forms) {
        const form = formsById.get(formId);
        if (form === undefined || form.fieldSet !== setId) {
          throw new FormCompositionError('unknown-form', at, `forms names '${formId}', which is not a form of '${setId}'`, `Name a form of '${setId}': ${formsOf(setId).map((f) => f.id).join(', ') || '(none declared)'}.`);
        }
        forms.push(formId);
      }
    } else {
      forms = showing.map((form) => form.id);
    }

    if (override.position !== undefined) {
      const position = override.position;
      for (const formId of forms) {
        const form = formsById.get(formId)!;
        const anchor = position.before ?? position.after;
        if (anchor !== undefined) {
          const anchorResolved = declared.resolve(anchor);
          if (anchorResolved === undefined || !formKeys(form).includes(anchorResolved.key)) {
            throw new FormCompositionError(
              'unknown-field',
              { moduleId, fieldSet: setId, field: anchor },
              `the position of '${fieldKey}' anchors on '${anchor}', which form '${formId}' does not show`,
              'Anchor on a key the form shows, or narrow the override with forms.',
            );
          }
          if (position.section !== undefined && sectionOf(form, anchorResolved.key) !== position.section) {
            throw new FormCompositionError(
              'unknown-section',
              at,
              `the position names section '${position.section}', and its anchor '${anchor}' is in section '${sectionOf(form, anchorResolved.key)}' of '${formId}'`,
              'Name the anchor’s own section, or leave the section out.',
            );
          }
        } else if (position.section !== undefined && !form.sections.some((section) => section.key === position.section)) {
          throw new FormCompositionError(
            'unknown-section',
            at,
            `the position names section '${position.section}', which form '${formId}' does not have`,
            `Name a section of '${formId}': ${form.sections.map((section) => section.key).join(', ')}.`,
          );
        }
      }
    }

    if (override.validation !== undefined) {
      const loosening = looseningOf(field, override.validation);
      if (loosening !== null) {
        throw new FormCompositionError('override-loosens-rule', at, `the tightening is not a narrowing of core: ${loosening}`, 'A deployment may only narrow what core accepts (FR-022).');
      }
      if (override.validation.format !== undefined && formatOwner(override.validation.format) === undefined) {
        throw new FormCompositionError(
          'format-without-validator',
          at,
          `validation.format '${override.validation.format}' is neither a platform format nor registered with ctx.fieldFormats`,
          `Register a validator for '${override.validation.format}' from its module’s backend (ctx.fieldFormats), or use a platform format.`,
        );
      }
    }

    let controlModuleId: string | null = null;
    if (override.control !== undefined) {
      const entry = controls.get(override.control);
      if (entry === undefined) {
        throw new FormCompositionError(
          'unknown-control',
          at,
          `control '${override.control}' is neither a platform control nor declared in any composed manifest’s inputControls`,
          'Declare the control in its module’s manifest (inputControls), or pick a platform control.',
        );
      }
      if (!controlFits(field, entry.control, override)) {
        throw new FormCompositionError(
          'control-type-mismatch',
          at,
          `control '${override.control}' outputs ${entry.control.outputType}${entry.control.optionsFromField ? ' (options from the field)' : ''}, which does not fit a ${field.type} field`,
          'Pick a control whose output type fits the field (input-controls.md §2); a select on a string field needs validation.options.',
        );
      }
      const format = entry.control.format;
      if (format !== undefined && !isPlatformFormat(format) && formats.get(format)?.moduleId !== entry.moduleId) {
        throw new FormCompositionError(
          'format-without-validator',
          at,
          `control '${override.control}' declares format '${format}', and its module '${entry.moduleId}' registers no validator for it`,
          `Register the validator from '${entry.moduleId}'’s backend: ctx.fieldFormats([{ id: '${format}', validate }]).`,
        );
      }
      controlModuleId = entry.moduleId;
    }

    for (const condition of [override.visibleWhen, override.requiredWhen]) {
      if (condition === undefined) continue;
      for (const name of conditionFields(condition)) {
        const resolvedName = declared.resolve(name);
        const ownSlot = name.startsWith(`${moduleId}.`) && resolvedName === undefined;
        if (resolvedName === undefined && !ownSlot) {
          throw new FormCompositionError(
            'condition-foreign-field',
            at,
            `a condition names '${name}', which is neither a key of '${setId}' nor a slot field of '${moduleId}'`,
            `Name a key of '${setId}', or '${moduleId}.<key>' for this module’s own slot field (field-rules.md §3).`,
          );
        }
      }
    }

    if (override.writePermission !== undefined && !permissions.has(override.writePermission)) {
      throw new FormCompositionError(
        'unknown-permission',
        at,
        `writePermission '${override.writePermission}' is not a permission any composed manifest declares`,
        'Declare the permission in this module’s manifest (permissions), or name a declared one.',
      );
    }

    const list = sealedOverrides.get(setId) ?? [];
    list.push({ moduleId, origin, override, fieldKey, field, forms, kinds, controlModuleId });
    sealedOverrides.set(setId, list);
  }

  // ---- Overrides against each other ------------------------------------------
  const fieldSets = new Map<string, SealedFieldSet>();
  for (const { moduleId: owner, set, resolve } of sets.values()) {
    const overrides = sealedOverrides.get(set.id) ?? [];
    const forms = formsOf(set.id);

    const presentation = new Map<string, string>();
    for (const sealed of overrides) {
      for (const kind of sealed.kinds) {
        if (SERVER_KINDS.has(kind) || NON_CONFLICTING.has(kind)) continue;
        for (const formId of sealed.forms) {
          const slot = `${sealed.fieldKey}\0${formId}\0${kind}`;
          const other = presentation.get(slot);
          if (other !== undefined && other !== sealed.moduleId) {
            throw new FormCompositionError(
              'override-conflict',
              { moduleId: sealed.moduleId, fieldSet: set.id, field: sealed.fieldKey },
              `'${other}' and '${sealed.moduleId}' both set ${kind} on form '${formId}'`,
              'One module sets one presentation kind of one field per form; narrow one override with forms, or drop one.',
            );
          }
          presentation.set(slot, sealed.moduleId);
        }
      }
    }

    const ownerWritePermissions = new Map<string, string>();
    for (const field of set.fields) if (field.writePermission !== undefined) ownerWritePermissions.set(field.key, field.writePermission);

    const rules = new Map<string, RuleContribution[]>();
    const validations = new Map<string, { moduleId: string; validation: FieldValidationTightening }[]>();
    const writePermissionOf = new Map<string, { moduleId: string; code: string }>();
    for (const sealed of overrides) {
      const { override } = sealed;
      if (override.writePermission !== undefined) {
        const existing = writePermissionOf.get(sealed.fieldKey);
        const ownerCode = ownerWritePermissions.get(sealed.field.key);
        const clash = existing !== undefined && existing.code !== override.writePermission ? existing.moduleId : ownerCode !== undefined && ownerCode !== override.writePermission ? owner : undefined;
        if (clash !== undefined) {
          throw new FormCompositionError(
            'override-conflict',
            { moduleId: sealed.moduleId, fieldSet: set.id, field: sealed.fieldKey },
            `'${clash}' already sets a different writePermission on the field`,
            'A field has one effective writePermission: name the same code, or leave it to the module that sets it.',
          );
        }
        writePermissionOf.set(sealed.fieldKey, { moduleId: sealed.moduleId, code: override.writePermission });
      }
      const controlFormat = override.control === undefined ? undefined : controls.get(override.control)?.control.format;
      const validation: FieldValidationTightening | undefined =
        controlFormat !== undefined ? { ...(override.validation ?? {}), format: override.validation?.format ?? controlFormat } : override.validation;
      if (validation === undefined && override.requiredWhen === undefined && override.writePermission === undefined) continue;
      const requires = new Set([sealed.moduleId]);
      if (sealed.controlModuleId !== null) requires.add(sealed.controlModuleId);
      const format = validation?.format;
      const formatModule = format === undefined ? null : formatOwner(format);
      if (formatModule !== null && formatModule !== undefined) requires.add(formatModule);
      const list = rules.get(sealed.fieldKey) ?? [];
      list.push({
        moduleId: sealed.moduleId,
        requires: [...requires].sort(),
        ...(validation === undefined ? {} : { validation }),
        ...(override.requiredWhen === undefined ? {} : { requiredWhen: override.requiredWhen }),
        ...(override.writePermission === undefined ? {} : { writePermission: override.writePermission }),
      });
      rules.set(sealed.fieldKey, list);
      if (validation !== undefined) {
        const merged = validations.get(sealed.fieldKey) ?? [];
        merged.push({ moduleId: sealed.moduleId, validation });
        validations.set(sealed.fieldKey, merged);
      }
    }

    // Several modules' `requiredWhen` on one field are served as one
    // `{ any: [...] }` (the field is required when any holds), and the
    // response holds a condition to the caps — so a combination over them is
    // refused here rather than failing every admin's effective forms.
    for (const [fieldKey, contributions] of rules) {
      const conditions = contributions.flatMap((c) => (c.requiredWhen === undefined ? [] : [c.requiredWhen]));
      if (conditions.length > 1 && !FieldConditionSchema.safeParse({ any: conditions }).success) {
        throw new FormCompositionError(
          'override-conflict',
          { moduleId: contributions.map((c) => c.moduleId).join(', '), fieldSet: set.id, field: fieldKey },
          'the modules\u2019 requiredWhen conditions together exceed the condition caps (depth 4, 16 leaves)',
          'Simplify the conditions, or let one module state the requirement.',
        );
      }
    }

    for (const [fieldKey, contributions] of validations) {
      const field = resolve(fieldKey)!.field;
      const merged: MergedValidation = mergeValidation(contributions);
      const contradiction = contradictionOf(field, merged);
      if (contradiction !== null) {
        throw new FormCompositionError(
          'override-contradiction',
          { moduleId: contributions.map((c) => c.moduleId).join(', '), fieldSet: set.id, field: fieldKey },
          `the tightenings of ${[...new Set(contributions.map((c) => c.moduleId))].join(' and ')} together admit no value: ${contradiction}`,
          'Make the modules’ rules compatible, or drop one.',
        );
      }
    }

    // required-not-fillable (D-300.12): effectively required on a create form,
    // and hidden there — a hidden field is never submitted, so no derivation
    // can fill it. `readOnly` there is `check:admin-forms`' to judge, because
    // whether a `fieldBehaviours` derivation fills it is the admin layer's.
    for (const form of forms.filter((f) => f.mode === 'create')) {
      for (const key of formKeys(form)) {
        const field = resolve(key)!.field;
        const tightened = (validations.get(key) ?? []).some((contribution) => contribution.validation.required === true);
        if (!field.required && !tightened) continue;
        const blocker = overrides.find((sealed) => sealed.fieldKey === key && sealed.forms.includes(form.id) && sealed.override.hidden === true);
        if (blocker !== undefined) {
          throw new FormCompositionError(
            'required-not-fillable',
            { moduleId: blocker.moduleId, fieldSet: set.id, field: key },
            `the field is required on create form '${form.id}', and the override hides it there, so it is never submitted`,
            'Narrow the hiding override to edit forms with forms, or drop the tightened requirement; a field a create form must carry is shown on it.',
          );
        }
      }
    }

    fieldSets.set(set.id, {
      id: set.id,
      ownerModuleId: owner,
      set,
      forms,
      overrides,
      rules,
      ownerWritePermissions,
      field: (key) => resolve(key)?.field,
    });
  }

  const writersByAction = new Map<string, SealedWriter[]>();
  for (const [setId, writers] of [...registered].sort(([a], [b]) => byCodePoint(a, b))) {
    const sealed = fieldSets.get(setId)!;
    for (const writer of writers) {
      const list = writersByAction.get(writer.on.action) ?? [];
      list.push({ set: sealed, writer });
      writersByAction.set(writer.on.action, list);
    }
  }

  return {
    fieldSets,
    forms: [...fieldSets.values()].flatMap((set) => set.forms),
    writersByAction,
    controls,
    formats,
    warnings,
  };
}
