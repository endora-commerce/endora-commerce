import type { EntityManager } from '@mikro-orm/core';
import { extensionColumnsWithPresence, type ModulePresenceReader } from './accessor.js';
import type { ColumnExtension } from './types.js';

/**
 * `schemaExtensionReads` — extension attributes on an extensible host's admin
 * reads (`specs/178-extensible-columns/` FR-051, FR-052,
 * `contracts/extension-attributes.md` §2).
 *
 * A host route that accepts `?extensions=` hands the records it already
 * authorised to {@link SchemaExtensionReads.attach}, which answers, per record
 * id, the requested modules' declared values. One query per requested module per
 * response — never one per record. A requested module is included only when it
 * declares the host with `adminReads: true` (OD-178-5, opt-in) **and** is
 * effectively present; anything else is omitted without an error, because off
 * behaves as never installed (Constitution XVII).
 */

export type ExtensionJsonValue =
  | string
  | number
  | boolean
  | null
  | ExtensionJsonValue[]
  | { [key: string]: ExtensionJsonValue };

/** record id → module id → key → value. */
export type ExtensionAttributeMap = ReadonlyMap<string, Record<string, Record<string, ExtensionJsonValue>>>;

export interface SchemaExtensionReads {
  attach<T extends { readonly id: string }>(
    em: EntityManager,
    host: string,
    records: readonly T[],
    requested: readonly string[],
  ): Promise<ExtensionAttributeMap>;
}

/** A value as the wire carries it: ISO timestamps, everything else as stored. */
function toJson(value: unknown): ExtensionJsonValue {
  if (value instanceof Date) return value.toISOString();
  return value as ExtensionJsonValue;
}

export function createSchemaExtensionReads(deps: {
  /** The declarations the platform registered — read per call, so a test can swap them. */
  readonly declarations: () => readonly ColumnExtension[];
  readonly state: ModulePresenceReader;
}): SchemaExtensionReads {
  return {
    async attach(em, host, records, requested) {
      const out = new Map<string, Record<string, Record<string, ExtensionJsonValue>>>();
      if (records.length === 0 || requested.length === 0) return out;
      const ids = records.map((record) => record.id);
      for (const moduleId of [...new Set(requested)]) {
        const declaration = deps
          .declarations()
          .find((candidate) => candidate.module === moduleId && candidate.host === host);
        if (declaration === undefined || !declaration.adminReads) continue;
        if (!deps.state.isPresent(moduleId)) continue;
        const values = await extensionColumnsWithPresence(deps.state, declaration, em).load(ids);
        for (const [id, row] of values) {
          const attributes = out.get(id) ?? {};
          attributes[moduleId] = Object.fromEntries(
            Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, toJson(value)]),
          );
          out.set(id, attributes);
        }
      }
      return out;
    },
  };
}
