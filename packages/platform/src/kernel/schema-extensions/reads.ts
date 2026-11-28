import type { EntityManager } from '@mikro-orm/core';
import { EntityExtensionLoaderOutputError } from '../entity-extensions/errors.js';
import type { EntityExtensionLoaderLookup } from '../entity-extensions/reads.js';
import { extensionColumnsWithPresence, type ModulePresenceReader } from './accessor.js';
import { ENTITY_EXTENSION_HOSTS } from './extensible-hosts.js';
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
 *
 * A module may serve the key from a side table instead
 * (`specs/193-admin-form-extensions/` FR-015, D-300.1; 187 R-17): its loader
 * for the host's entity, registered with `adminReads: true`, is called once per
 * response with the records' ids and its values parsed with its schema, `null`
 * on a record without one — as the read ports attach it. A module never serves
 * both under one key on one host: the loader registry refuses that pair
 * (`loader-and-columns-on-one-host`). Unlike a read port's `include`, a key no
 * module serves is omitted, never `422 ENTITY_EXTENSION_UNCLAIMED` (R-17 rule 2).
 */

export type ExtensionJsonValue =
  | string
  | number
  | boolean
  | null
  | ExtensionJsonValue[]
  | { [key: string]: ExtensionJsonValue };

/**
 * record id → module id → value: D2's key → value record, or an `adminReads`
 * loader's value (`null` where the record has none).
 */
export type ExtensionAttributeMap = ReadonlyMap<string, Record<string, ExtensionJsonValue>>;

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

/** A loader's value as the wire carries it: every timestamp in it an ISO string. */
function toJsonDeep(value: unknown): ExtensionJsonValue {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJsonDeep(entry)]));
  }
  return value as ExtensionJsonValue;
}

/** The side-table host reference (`<ownerModuleId>.<EntityClassName>`) of a D2 host table. */
function entityOfHost(table: string): string | undefined {
  for (const [entity, host] of ENTITY_EXTENSION_HOSTS) if (host.table === table) return entity;
  return undefined;
}

export function createSchemaExtensionReads(deps: {
  /** The declarations the platform registered — read per call, so a test can swap them. */
  readonly declarations: () => readonly ColumnExtension[];
  readonly state: ModulePresenceReader;
  /**
   * The composition's side-table loaders (FR-015). Absent: a module that serves
   * no columns is omitted, as before the loaders could be read here.
   */
  readonly loaders?: EntityExtensionLoaderLookup;
}): SchemaExtensionReads {
  return {
    async attach(em, host, records, requested) {
      const out = new Map<string, Record<string, ExtensionJsonValue>>();
      if (records.length === 0 || requested.length === 0) return out;
      const ids = records.map((record) => record.id);
      const entity = entityOfHost(host);

      /** `moduleId`'s `adminReads` loader on `host`, when it has one and is present. */
      const attachLoaded = async (moduleId: string): Promise<void> => {
        const loader = entity === undefined ? undefined : deps.loaders?.loaderFor(moduleId, entity);
        if (loader === undefined || !loader.adminReads) return;
        if (!deps.state.isPresent(moduleId)) return;
        // No catch: a loader's error is the read's error.
        const loaded = await loader.load(ids, { em });
        for (const id of ids) {
          let parsed: unknown = null;
          if (loaded.has(id)) {
            const result = loader.schema.safeParse(loaded.get(id));
            if (!result.success) {
              throw new EntityExtensionLoaderOutputError({
                moduleId,
                host: loader.host,
                detail:
                  `for id "${id}": ` +
                  result.error.issues
                    .map((issue) => `${issue.path.join('.') || '(value)'}: ${issue.message}`)
                    .join('; '),
              });
            }
            parsed = result.data;
          }
          const attributes = out.get(id) ?? {};
          attributes[moduleId] = toJsonDeep(parsed);
          out.set(id, attributes);
        }
      };
      for (const moduleId of [...new Set(requested)]) {
        const declaration = deps
          .declarations()
          .find((candidate) => candidate.module === moduleId && candidate.host === host);
        if (declaration === undefined || !declaration.adminReads) {
          await attachLoaded(moduleId);
          continue;
        }
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
