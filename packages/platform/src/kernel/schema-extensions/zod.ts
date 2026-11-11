import { z } from 'zod';
import { isCalendarDate, numericPattern, resolvedColumnExtension } from './define.js';
import type {
  ColumnExtension,
  ColumnExtensionPatch,
  ColumnExtensionValues,
  ResolvedColumn,
} from './types.js';

/**
 * The Zod schemas equivalent to a declaration's inferred types (FR-002,
 * `data-model.md` §3). The accessor validates every patch with
 * {@link columnExtensionPatchSchema}; a module may parse a caller's input with
 * the same schema before it reaches the accessor.
 */

const INT2: readonly [number, number] = [-32768, 32767];
const INT4: readonly [number, number] = [-2147483648, 2147483647];

/** The schema of one column's non-null value. */
export function columnValueSchema(column: ResolvedColumn): z.ZodType {
  const { spec } = column;
  switch (spec.type) {
    case 'text':
      return z.string();
    case 'varchar':
      return z.string().max(spec.length!);
    case 'boolean':
      return z.boolean();
    case 'smallint':
      return z.number().int().min(INT2[0]).max(INT2[1]);
    case 'integer':
      return z.number().int().min(INT4[0]).max(INT4[1]);
    case 'bigint':
      return z.string().regex(/^-?\d{1,19}$/);
    case 'numeric':
      return z.string().regex(numericPattern(spec.precision!, spec.scale!));
    case 'date':
      return z.string().refine(isCalendarDate, { message: 'a calendar date, YYYY-MM-DD' });
    case 'timestamptz':
      return z.date();
    case 'uuid':
      return z.uuid();
    case 'jsonb':
      return column.jsonSchema ?? z.json();
  }
}

function shapeOf(declaration: ColumnExtension): Record<string, z.ZodType> {
  return Object.fromEntries(
    resolvedColumnExtension(declaration).columns.map((column) => {
      const value = columnValueSchema(column);
      return [column.key, column.spec.nullable ? value.nullable() : value];
    }),
  );
}

const fullSchemas = new WeakMap<object, z.ZodType>();
const patchSchemas = new WeakMap<object, z.ZodType>();

/** Every declared key, each with its value — strict: an undeclared key is refused. */
export function columnExtensionSchema<D extends ColumnExtension>(
  declaration: D,
): z.ZodType<ColumnExtensionValues<D>> {
  let schema = fullSchemas.get(declaration);
  if (schema === undefined) {
    schema = z.strictObject(shapeOf(declaration));
    fullSchemas.set(declaration, schema);
  }
  return schema as z.ZodType<ColumnExtensionValues<D>>;
}

/** Any subset of the declared keys — strict: an undeclared key is refused. */
export function columnExtensionPatchSchema<D extends ColumnExtension>(
  declaration: D,
): z.ZodType<ColumnExtensionPatch<D>> {
  let schema = patchSchemas.get(declaration);
  if (schema === undefined) {
    schema = z.strictObject(shapeOf(declaration)).partial();
    patchSchemas.set(declaration, schema);
  }
  return schema as z.ZodType<ColumnExtensionPatch<D>>;
}
