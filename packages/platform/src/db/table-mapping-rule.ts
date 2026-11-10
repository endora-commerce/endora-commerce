import type { MetadataStorage } from '@mikro-orm/core';
import { DuplicateTableMappingError } from '../kernel/schema-extensions/errors.js';
import type { AllowedProjections } from './schema-extension-projection.js';

/**
 * The replacement for MikroORM's duplicate-table check
 * (`specs/178-extensible-columns/` FR-031, research R-3).
 *
 * MikroORM refuses two entities on one table, and a declared extension's
 * projection is exactly that. The platform therefore turns MikroORM's check off
 * — **only** here, and only together with this rule, which a unit test holds —
 * and refuses every table mapped more than once unless exactly one mapping is
 * not a projection the platform built for a validated declaration, and every
 * projection maps nothing beyond {PK, tenant key, declared columns}.
 */

interface MappedMeta {
  readonly className: string;
  readonly tableName?: string;
  readonly collection?: string;
  readonly abstract?: boolean;
  readonly embeddable?: boolean;
  readonly virtual?: boolean;
  readonly root?: unknown;
  readonly schema?: string;
  readonly properties: Record<string, unknown>;
}

export function assertTableMappings(storage: MetadataStorage, allowed: AllowedProjections): void {
  const byTable = new Map<string, MappedMeta[]>();
  for (const meta of Object.values(storage.getAll()) as MappedMeta[]) {
    if (meta.abstract || meta.embeddable || meta.virtual) continue;
    // A single-table-inheritance child shares its root's table by design.
    if (meta.root !== undefined && meta.root !== meta) continue;
    const table = meta.tableName ?? meta.collection;
    if (table === undefined) continue;
    const key = `${meta.schema === undefined ? '' : `${meta.schema}.`}${table}`;
    const mapped = byTable.get(key);
    if (mapped) mapped.push(meta);
    else byTable.set(key, [meta]);
  }

  for (const [table, mappings] of byTable) {
    if (mappings.length < 2) continue;
    const projections = allowed.get(table) ?? new Map<string, ReadonlySet<string>>();
    const names = mappings.map((meta) => meta.className).sort();
    const owners = mappings.filter((meta) => !projections.has(meta.className));
    if (owners.length !== 1) {
      throw new DuplicateTableMappingError(
        table,
        names,
        owners.length === 0
          ? 'every mapping is a projection; the table has no owning entity'
          : 'only platform-built projections of declared extension columns may share a table ' +
            'with its owning entity (specs/178-extensible-columns/ FR-031)',
      );
    }
    for (const meta of mappings) {
      const permitted = projections.get(meta.className);
      if (permitted === undefined) continue;
      const extra = Object.keys(meta.properties).filter((property) => !permitted.has(property));
      if (extra.length > 0) {
        throw new DuplicateTableMappingError(
          table,
          names,
          `projection "${meta.className}" maps ${extra.sort().join(', ')}, beyond its PK, tenant ` +
            `key and declared columns`,
        );
      }
    }
  }
}

/** The discovery pair `mikroOrmConfigFrom` always sets: MikroORM's check off, this rule on. */
export function schemaExtensionDiscovery(allowed: AllowedProjections): {
  readonly checkDuplicateTableNames: false;
  readonly afterDiscovered: (storage: MetadataStorage) => void;
} {
  return {
    checkDuplicateTableNames: false,
    afterDiscovered: (storage) => assertTableMappings(storage, allowed),
  };
}
