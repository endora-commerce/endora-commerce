/**
 * `@endora-commerce/test-kit/forms` — the owner-side proofs that a field set
 * agrees with the host's write contract, and that its writers project what
 * they write (`expectFieldSetWriters`, T028) (`specs/193-admin-form-extensions/`
 * FR-003, T017; `contracts/field-rules.md` §2).
 *
 * A field set restates, per field, what the host's create and update body
 * schemas already say: the value type, required-ness on create, the core
 * bounds and an enum's options. Composition narrows overrides against the
 * declaration and the admin renders from it, so a declaration that drifts from
 * the schemas promises an operator a rule the API does not hold. Nothing static
 * sees both, so the owner calls this from its own tests.
 *
 * The schemas are read structurally (Zod 4's `_zod.def` / `_zod.bag`), so the
 * kit takes no `zod` dependency: the caller's schemas are the ones it already
 * has.
 */

import { AssertionError } from 'node:assert';
import type { FieldDeclaration, FieldSetDeclaration, FieldValueType } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import type { FieldSetRegistration } from '@endora-commerce/platform/kernel';

/** What the helper reads of a Zod 4 schema. Any `z.ZodType` satisfies it. */
export interface ZodSchemaLike {
  readonly _zod: { readonly def: unknown; readonly bag?: unknown; readonly optin?: unknown };
}

export interface FieldSetWriteSchemas {
  /** The host's admin create body schema, a `z.object(…)`. */
  readonly create?: ZodSchemaLike;
  /** The host's admin update body schema, a `z.object(…)`. */
  readonly update?: ZodSchemaLike;
}

interface Def {
  readonly type: string;
  readonly innerType?: ZodSchemaLike;
  readonly in?: ZodSchemaLike;
  readonly getter?: () => ZodSchemaLike;
  readonly shape?: Readonly<Record<string, ZodSchemaLike>>;
  readonly element?: ZodSchemaLike;
  readonly valueType?: ZodSchemaLike;
  readonly entries?: Readonly<Record<string, unknown>>;
  readonly values?: readonly unknown[];
  readonly options?: readonly ZodSchemaLike[];
}

interface Bag {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly format?: string;
}

const defOf = (schema: ZodSchemaLike): Def => schema._zod.def as Def;
const bagOf = (schema: ZodSchemaLike): Bag => (schema._zod.bag ?? {}) as Bag;

/** Strip the wrappers that do not change what a value is: optional, nullable, default, readonly, a pipe's input. */
function unwrap(schema: ZodSchemaLike): ZodSchemaLike {
  for (let current = schema, guard = 0; guard < 32; guard += 1) {
    const def = defOf(current);
    if (def.innerType && ['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional'].includes(def.type)) {
      current = def.innerType;
    } else if (def.type === 'pipe' && def.in) {
      current = def.in;
    } else if (def.type === 'lazy' && def.getter) {
      current = def.getter();
    } else if (def.type === 'union' && def.options) {
      // `z.union([x, z.null()])` is a nullable `x`.
      const meaningful = def.options.filter((option) => !['null', 'undefined'].includes(defOf(unwrap(option)).type));
      if (meaningful.length !== 1) return current;
      current = meaningful[0]!;
    } else {
      return current;
    }
  }
  return schema;
}

/** The enum vocabulary a schema accepts, or `null` when it is not an enum. */
function zodEnumOptions(schema: ZodSchemaLike): string[] | null {
  const def = defOf(schema);
  if (def.type === 'enum' && def.entries) return Object.values(def.entries).map(String);
  if (def.type === 'literal' && def.values) return def.values.map(String);
  if (def.type === 'union' && def.options) {
    const values: string[] = [];
    for (const option of def.options) {
      const inner = zodEnumOptions(unwrap(option));
      if (inner === null) return null;
      values.push(...inner);
    }
    return values;
  }
  return null;
}

const INTEGER_FORMATS = new Set(['safeint', 'int32', 'uint32']);
const isInteger = (schema: ZodSchemaLike): boolean =>
  defOf(schema).type === 'number' && INTEGER_FORMATS.has(bagOf(schema).format ?? '');

/** Does the (unwrapped) schema hold a value of `type`? `null` when it does, else what it holds. */
function typeMismatch(type: FieldValueType, schema: ZodSchemaLike): string | null {
  const kind = defOf(schema).type;
  const element = (): ZodSchemaLike | null => {
    const inner = defOf(schema).element;
    return kind === 'array' && inner ? unwrap(inner) : null;
  };
  const ok = (() => {
    switch (type) {
      case 'string':
      case 'reference':
        return kind === 'string';
      case 'integer':
        return isInteger(schema);
      case 'decimal':
        // A number, or a decimal string (money and quantities travel as strings).
        return kind === 'number' || kind === 'string';
      case 'boolean':
        return kind === 'boolean';
      case 'date':
      case 'datetime':
        return kind === 'string' || kind === 'date';
      case 'enum':
        return zodEnumOptions(schema) !== null;
      case 'string[]':
      case 'reference[]': {
        const inner = element();
        return inner !== null && defOf(inner).type === 'string';
      }
      case 'enum[]': {
        const inner = element();
        return inner !== null && zodEnumOptions(inner) !== null;
      }
      case 'composite':
        return kind === 'object' || kind === 'record';
    }
  })();
  return ok ? null : kind === 'array' ? `array of ${defOf(element() ?? schema).type}` : kind;
}

/** A bound Zod reports but nobody wrote: `z.int()`'s safe-integer range. */
const isImplicit = (value: number | undefined): boolean =>
  value === undefined || Math.abs(value) === Number.MAX_SAFE_INTEGER || !Number.isFinite(value);

function boundsOf(type: FieldValueType, schema: ZodSchemaLike): Record<string, number | undefined> {
  // Length bounds of an array field are its elements' (`FieldDeclaration.bounds`).
  const subject = type.endsWith('[]') ? unwrap(defOf(schema).element ?? schema) : schema;
  const bag = bagOf(subject);
  const kind = defOf(subject).type;
  if (kind === 'string') return { minLength: bag.minimum, maxLength: bag.maximum };
  if (kind === 'number') {
    return { min: isImplicit(bag.minimum) ? undefined : bag.minimum, max: isImplicit(bag.maximum) ? undefined : bag.maximum };
  }
  return {};
}

/** Resolve a field key in an object schema: `name`, `attributeValues.color`, or a family `attributeValues.*`. */
function resolve(key: string, root: ZodSchemaLike): { readonly schema: ZodSchemaLike; readonly optional: boolean } | null {
  let current = unwrap(root);
  let optional = false;
  const segments = key.split('.');
  for (const segment of segments) {
    const def = defOf(current);
    if (segment === '*') {
      if (def.type !== 'record' || !def.valueType) return null;
      current = unwrap(def.valueType);
      continue;
    }
    const shape = def.type === 'object' ? def.shape : undefined;
    const child = shape && Object.prototype.hasOwnProperty.call(shape, segment) ? shape[segment] : undefined;
    if (!child) return null;
    if (child._zod.optin === 'optional') optional = true;
    current = unwrap(child);
  }
  // A key the schema refuses outright (`z.never()`, as a PATCH refusing a field
  // only another write sets) carries nothing: it is not this schema's field.
  if (defOf(current).type === 'never') return null;
  return { schema: current, optional };
}

function compare(
  field: FieldDeclaration,
  label: 'create' | 'update',
  resolved: { readonly schema: ZodSchemaLike; readonly optional: boolean },
  problems: string[],
): void {
  const at = `'${field.key}' (${label})`;
  const mismatch = typeMismatch(field.type, resolved.schema);
  if (mismatch !== null) {
    problems.push(`${at}: declared ${field.type}, the schema holds ${mismatch}.`);
    return;
  }
  if (label === 'create' && field.required === resolved.optional) {
    problems.push(
      field.required
        ? `${at}: declared required on create, the create schema makes it optional.`
        : `${at}: declared optional, the create schema makes it required.`,
    );
  }
  const actual = boundsOf(field.type, resolved.schema);
  const declared = field.bounds ?? {};
  for (const bound of ['minLength', 'maxLength', 'min', 'max'] as const) {
    if (!(bound in actual) && declared[bound] === undefined) continue;
    if (declared[bound] !== actual[bound]) {
      problems.push(`${at}: ${bound} is ${String(declared[bound] ?? 'absent')} in the declaration and ${String(actual[bound] ?? 'absent')} in the schema.`);
    }
  }
  if (field.type === 'enum' || field.type === 'enum[]') {
    const subject = field.type === 'enum[]' ? unwrap(defOf(resolved.schema).element ?? resolved.schema) : resolved.schema;
    const options = [...(zodEnumOptions(subject) ?? [])].sort();
    const declaredOptions = [...(field.options ?? [])].sort();
    if (JSON.stringify(options) !== JSON.stringify(declaredOptions)) {
      problems.push(`${at}: options are [${declaredOptions.join(', ')}] in the declaration and [${options.join(', ')}] in the schema.`);
    }
  }
}

/**
 * Fail unless every field of `set` agrees with the host's write schemas: it is
 * carried by at least one of them, with the declared value type, core bounds
 * and enum options in each that carries it, and — in `create` — required
 * exactly when the declaration says so. Every disagreement is reported at once.
 * Schema keys the set does not declare are not its concern.
 */
export function expectFieldSetMatchesSchemas(set: FieldSetDeclaration, schemas: FieldSetWriteSchemas): void {
  const given = (['create', 'update'] as const).filter((label) => schemas[label] !== undefined);
  if (given.length === 0) {
    throw new AssertionError({
      message: `expectFieldSetMatchesSchemas('${set.id}'): pass the host's create schema, its update schema, or both.`,
    });
  }
  const problems: string[] = [];
  for (const field of set.fields) {
    let carried = false;
    for (const label of given) {
      const resolved = resolve(field.key, schemas[label]!);
      if (resolved === null) {
        if (label === 'create' && field.required) {
          problems.push(`'${field.key}' (create): declared required on create, the create schema has no such key.`);
        }
        continue;
      }
      carried = true;
      compare(field, label, resolved, problems);
    }
    if (!carried) problems.push(`'${field.key}': no write schema carries it (${given.join(', ')}).`);
  }
  if (problems.length > 0) {
    throw new AssertionError({
      message:
        `expectFieldSetMatchesSchemas: field set '${set.id}' disagrees with its write schemas (FR-003):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    });
  }
}

// ---------------------------------------------------------------------------
// The writers (T028, `contracts/field-rules.md` §2, invariant I-5)
// ---------------------------------------------------------------------------

/** One writer's Command and a result of its run, to feed `hookData` with. */
export interface FieldSetWriterCase<TResult = unknown> {
  readonly command: Command<TResult>;
  readonly result: TResult;
}

/** A writer the owner lists and does not exercise here, with the reason (e.g. a buyer-only path, D-300.3). */
export interface FieldSetWriterSkip {
  readonly skip: string;
}

/**
 * Fail unless every writer of `registration` is proven by its Command: there
 * is a case for each writer's action and a writer for each case; the Command
 * is that action's and supplies `hookData` — the bus answers a writer without
 * it with `500 COMMAND_HOOK_DATA_MISSING` — and the writer's projection of that
 * hook data returns every key it lists in `writes`: in `after`, and on an
 * update with a `before` holding them or a `changed` list. A scoped writer
 * projects an array with one entry per saved scope, each held the same way. A
 * family key (`attributeValues.*`) is data-driven and is not asked for. Every
 * problem is reported at once.
 */
export function expectFieldSetWriters(
  registration: FieldSetRegistration,
  commandsByAction: Readonly<Record<string, FieldSetWriterCase<never> | FieldSetWriterCase<unknown> | FieldSetWriterSkip>>,
): void {
  const problems: string[] = [];
  const actions = new Set(registration.writers.map((writer) => writer.on.action));
  for (const action of Object.keys(commandsByAction).sort()) {
    if (!actions.has(action)) problems.push(`'${action}' has a Command here and is not a writer of the field set.`);
  }
  for (const writer of registration.writers) {
    const action = writer.on.action;
    const entry = commandsByAction[action];
    if (entry === undefined) {
      problems.push(`'${action}' is a writer and has no Command here: pass one, or { skip: '<reason>' }.`);
      continue;
    }
    if ('skip' in entry) {
      if (entry.skip.trim().length === 0) problems.push(`'${action}' is skipped with no reason; say why it is not exercised.`);
      continue;
    }
    const { command, result } = entry as FieldSetWriterCase<unknown>;
    if (command.action !== action) {
      problems.push(`'${action}': the Command given runs '${command.action}'.`);
      continue;
    }
    if (typeof command.hookData !== 'function') {
      problems.push(`'${action}': the Command supplies no hookData, which the field-rule check projects (COMMAND_HOOK_DATA_MISSING).`);
      continue;
    }
    const projected = writer.project(command.hookData(result));
    const scopes: readonly unknown[] =
      writer.scoped === true ? (Array.isArray(projected) ? projected : []) : Array.isArray(projected) ? [] : [projected];
    if (writer.scoped === true && !Array.isArray(projected)) {
      problems.push(`'${action}' is a scoped writer and its projection is not an array of scopes.`);
      continue;
    }
    if (writer.scoped !== true && Array.isArray(projected)) {
      problems.push(`'${action}' is not a scoped writer and its projection is an array.`);
      continue;
    }
    if (scopes.length === 0) problems.push(`'${action}' projects no scope.`);
    const literal = writer.writes.filter((key) => !key.endsWith('.*'));
    for (const [index, scope] of scopes.entries()) {
      const at = writer.scoped === true ? `'${action}' (scope ${index})` : `'${action}'`;
      const projection = scope as { readonly before?: unknown; readonly after?: unknown; readonly changed?: unknown };
      const after = projection.after;
      if (typeof after !== 'object' || after === null) {
        problems.push(`${at}: the projection has no after-state.`);
        continue;
      }
      const missing = literal.filter((key) => !Object.prototype.hasOwnProperty.call(after, key));
      if (missing.length > 0) problems.push(`${at}: writes ${missing.map((key) => `'${key}'`).join(', ')}, which the projection does not return in after.`);
      const hasChanged = Array.isArray(projection.changed);
      const before = projection.before;
      if (writer.mode === 'update' && !hasChanged) {
        if (typeof before !== 'object' || before === null) {
          problems.push(`${at}: an update projection returns before or changed; it returns neither.`);
        } else {
          const unknownBefore = literal.filter((key) => !Object.prototype.hasOwnProperty.call(before, key));
          if (unknownBefore.length > 0) problems.push(`${at}: writes ${unknownBefore.map((key) => `'${key}'`).join(', ')}, which the projection does not return in before.`);
        }
      }
    }
  }
  if (problems.length > 0) {
    throw new AssertionError({
      message:
        `expectFieldSetWriters: the writers of field set '${registration.set.id}' do not project what they write (I-5):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n'),
    });
  }
}
