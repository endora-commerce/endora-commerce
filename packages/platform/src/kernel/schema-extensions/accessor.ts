import type { EntityManager } from '@mikro-orm/core';
import { effectiveState } from '../lifecycle/effective-state.js';
import { ModuleDisabledError } from '../lifecycle/plugin-helpers.js';
import { resolvedColumnExtension } from './define.js';
import {
  ExtensionHostRowNotFoundError,
  ExtensionValueCorruptError,
  ExtensionWriteOutsideCommandError,
} from './errors.js';
import { projectionEntityNameOf } from './registry.js';
import { columnExtensionPatchSchema } from './zod.js';
import type {
  ColumnExtension,
  ColumnExtensionPatch,
  ColumnExtensionValues,
  ResolvedColumn,
} from './types.js';

/**
 * `extensionColumns(declaration, em)` — the one published way to read and write
 * a module's declared extension columns (`specs/178-extensible-columns/`
 * FR-033, `contracts/column-extension-declaration.md` §5).
 *
 * - **Gated** on the declaring module's effective state: off behaves as never
 *   installed, so every method throws `ModuleDisabledError` (Constitution XVII).
 * - **Fields-limited**: a read selects the PK and the declared columns only —
 *   never `select *` over the host's own columns (research R-1).
 * - **UPDATE-only**: `set` loads the managed projection row and assigns; the
 *   enclosing transaction's flush issues one UPDATE of the changed columns. The
 *   projection refuses INSERT and DELETE.
 * - **Inside a transaction**: `set` refuses to run outside one, so a write is
 *   always part of a Command or a command hook and is audited with it
 *   (Constitution XIII). It returns `changedFields` — sorted names, never
 *   values (audit-state D-288).
 */

export interface ExtensionColumnsAccessor<D extends ColumnExtension> {
  get(id: string): Promise<ColumnExtensionValues<D> | null>;
  load(ids: readonly string[]): Promise<Map<string, ColumnExtensionValues<D>>>;
  set(id: string, patch: ColumnExtensionPatch<D>): Promise<{ changedFields: string[] }>;
}

/** The one read the gate takes of effective state. */
export interface ModulePresenceReader {
  isPresent(moduleId: string): boolean;
}

/** How many ids one select carries. */
const CHUNK = 500;

function sameValue(column: ResolvedColumn, left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || left === undefined || right === undefined) return false;
  if (column.spec.type === 'timestamptz') {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (column.spec.type === 'jsonb') return JSON.stringify(left) === JSON.stringify(right);
  return String(left) === String(right);
}

export function extensionColumns<D extends ColumnExtension>(
  declaration: D,
  em: EntityManager,
): ExtensionColumnsAccessor<D> {
  return extensionColumnsWithPresence(effectiveState, declaration, em);
}

/**
 * {@link extensionColumns} over a presence reader of the caller's choosing.
 *
 * Not on `./kernel`: a module handed a presence seam could answer its own gate.
 * It is the host's (`./db`), for a composition that resolves presence itself and
 * for the platform's tests, which have no registry cache to switch a fixture
 * module on in.
 */
export function extensionColumnsWithPresence<D extends ColumnExtension>(
  state: ModulePresenceReader,
  declaration: D,
  em: EntityManager,
): ExtensionColumnsAccessor<D> {
  const resolved = resolvedColumnExtension(declaration);
  const keys = resolved.columns.map((column) => column.key);

  const gate = (): string => {
    if (!state.isPresent(declaration.module)) throw new ModuleDisabledError(declaration.module);
    return projectionEntityNameOf(declaration);
  };

  const valuesOf = (row: Record<string, unknown>, id: string): ColumnExtensionValues<D> => {
    const values: Record<string, unknown> = {};
    for (const column of resolved.columns) {
      const raw = row[column.key] ?? null;
      if (column.jsonSchema !== null && raw !== null) {
        const parsed = column.jsonSchema.safeParse(raw);
        if (!parsed.success) throw new ExtensionValueCorruptError(declaration.id, column.key, id);
        values[column.key] = parsed.data;
      } else {
        values[column.key] = raw;
      }
    }
    return values as ColumnExtensionValues<D>;
  };

  const load = async (ids: readonly string[]): Promise<Map<string, ColumnExtensionValues<D>>> => {
    const entityName = gate();
    const out = new Map<string, ColumnExtensionValues<D>>();
    const unique = [...new Set(ids)];
    for (let start = 0; start < unique.length; start += CHUNK) {
      const chunk = unique.slice(start, start + CHUNK);
      const rows = (await em.find(entityName, { id: { $in: chunk } } as never, {
        fields: keys as never,
      })) as Record<string, unknown>[];
      for (const row of rows) out.set(row['id'] as string, valuesOf(row, row['id'] as string));
    }
    return out;
  };

  return {
    load,

    async get(id) {
      return (await load([id])).get(id) ?? null;
    },

    async set(id, patch) {
      const entityName = gate();
      if (!em.isInTransaction()) throw new ExtensionWriteOutsideCommandError(declaration.id);
      const parsed = columnExtensionPatchSchema(declaration).parse(patch) as Record<string, unknown>;
      const row = (await em.findOne(entityName, { id } as never, { fields: keys as never })) as
        | Record<string, unknown>
        | null;
      if (row === null) throw new ExtensionHostRowNotFoundError(declaration.host, id);
      const changedFields: string[] = [];
      for (const column of resolved.columns) {
        if (!(column.key in parsed)) continue;
        const next = parsed[column.key];
        if (sameValue(column, row[column.key] ?? null, next)) continue;
        row[column.key] = next;
        changedFields.push(column.key);
      }
      return { changedFields: changedFields.sort() };
    },
  };
}
