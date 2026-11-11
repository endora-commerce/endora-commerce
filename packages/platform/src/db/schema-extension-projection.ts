import { BigIntType, DecimalType, EntitySchema, MetadataStorage } from '@mikro-orm/core';
import { ORG_FILTER, orgFilterCond } from '../tenancy/filters.js';
import {
  GlobalEntity,
  OrgScoped,
  RuleScoped,
  tenantClassifications,
  type ScopeClass,
} from '../tenancy/org-scoped.decorator.js';
import { resolvedColumnExtension } from '../kernel/schema-extensions/define.js';
import {
  ExtensionProjectionWriteError,
  SchemaExtensionInvalidError,
} from '../kernel/schema-extensions/errors.js';
import { recordProjectionEntityName } from '../kernel/schema-extensions/registry.js';
import type {
  ColumnExtension,
  ResolvedColumn,
  ResolvedColumnExtension,
} from '../kernel/schema-extensions/types.js';
import type { EntityClassLike } from '../packages/package-runtime.js';

/**
 * The ORM projection of a declaration (`specs/178-extensible-columns/`
 * FR-030 – FR-032, `contracts/orm-projection.md`; research R-1, R-2).
 *
 * One `EntitySchema` per declaration, on the host's own table, mapping the host
 * PK, the host's tenant key when it is `@OrgScoped`, and the declared columns —
 * nothing else. Core never learns about it: the core entity's metadata, its
 * INSERT … RETURNING and its serialisation are unchanged (OR-2). The projection
 * refuses INSERT and DELETE, so it can only ever update the columns it maps.
 */

/** The facts about a host entity the projection copies. */
export interface HostEntityFacts {
  readonly table: string;
  readonly className: string;
  readonly scope: ScopeClass;
}

/** table → projection entity name → the properties it may map. */
export type AllowedProjections = ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;

export interface SchemaExtensionProjections {
  readonly schemas: readonly EntitySchema[];
  readonly allowed: AllowedProjections;
}

/** `__x_<module>__<host>` — not exported anywhere a module can name it. */
function projectionEntityName(declaration: ColumnExtension): string {
  return `__x_${declaration.module}__${declaration.host}`;
}

/** The table a decorated entity class maps, read without side effects; `null` when undecorated. */
function decoratedTableOf(cls: EntityClassLike): string | null {
  if (!Object.hasOwn(cls, MetadataStorage.PATH_SYMBOL)) return null;
  const meta = MetadataStorage.getMetadataFromDecorator(cls as never) as {
    tableName?: string;
    collection?: string;
  };
  return meta.tableName ?? meta.collection ?? null;
}

/**
 * The entity that maps `table` among `entities`, and its classification.
 *
 * Refused when nothing maps it — the host module's entities are always
 * registered whether or not the module is switched on, so an absent host is a
 * composition that does not carry the owner at all, which V10 should have
 * refused — and when its classification is one no projection can copy.
 */
export function hostEntityFacts(
  entities: readonly EntityClassLike[],
  declaration: ColumnExtension,
): HostEntityFacts {
  const host = entities.find((cls) => decoratedTableOf(cls) === declaration.host);
  if (host === undefined) {
    throw new SchemaExtensionInvalidError(
      'host-not-extensible',
      declaration.module,
      null,
      `no entity of this composition maps "${declaration.host}"; the host module is not composed`,
    );
  }
  const classification = tenantClassifications().find((row) => row.target === host);
  if (classification === undefined) {
    throw new SchemaExtensionInvalidError(
      'host-not-extensible',
      declaration.module,
      null,
      `"${host.name}" carries no tenant-scope classification to copy (Constitution XI)`,
    );
  }
  if (!['org', 'global', 'rule'].includes(classification.scope)) {
    throw new SchemaExtensionInvalidError(
      'host-not-extensible',
      declaration.module,
      null,
      `"${host.name}" is ${classification.scope}-scoped; a projection copies org, global or rule scope only`,
    );
  }
  return { table: declaration.host, className: host.name, scope: classification.scope };
}

/** An `EntitySchema` property definition, as this builder writes them. */
type SchemaProperty = Record<string, unknown>;

/** The MikroORM property of one declared column (`data-model.md` §3). */
function propertyOf(column: ResolvedColumn): SchemaProperty {
  const { spec } = column;
  const base = { fieldName: column.physicalName, nullable: spec.nullable };
  switch (spec.type) {
    case 'text':
      return { ...base, type: 'text' };
    case 'varchar':
      return { ...base, type: 'string', length: spec.length! };
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'smallint':
      return { ...base, type: 'smallint' };
    case 'integer':
      return { ...base, type: 'integer' };
    case 'bigint':
      return { ...base, type: new BigIntType('string') };
    case 'numeric':
      return { ...base, type: new DecimalType('string'), precision: spec.precision!, scale: spec.scale! };
    case 'date':
      return { ...base, type: 'date' };
    case 'timestamptz':
      return { ...base, type: 'Date', columnType: 'timestamptz' };
    case 'uuid':
      return { ...base, type: 'uuid' };
    case 'jsonb':
      return { ...base, type: 'json' };
  }
}

/** The properties a projection of `resolved` may map — the rule checks against these. */
export function allowedPropertiesOf(
  resolved: ResolvedColumnExtension,
  scope: ScopeClass,
): ReadonlySet<string> {
  return new Set([
    'id',
    ...(scope === 'org' ? ['organizationId'] : []),
    ...resolved.columns.map((column) => column.key),
  ]);
}

const built = new WeakMap<ColumnExtension, { schema: EntitySchema; facts: HostEntityFacts }>();

/** The projection of one declaration — memoised by declaration identity. */
export function projectionSchemaOf(
  declaration: ColumnExtension,
  host: HostEntityFacts,
): EntitySchema {
  const cached = built.get(declaration);
  if (cached !== undefined) return cached.schema;

  const resolved = resolvedColumnExtension(declaration);
  const entityName = projectionEntityName(declaration);
  // A named class, so the tenancy registry, MikroORM and every error name the
  // projection the same way.
  const projection = { [entityName]: class {} }[entityName]!;
  const classify = { org: OrgScoped, global: GlobalEntity, rule: RuleScoped }[
    host.scope as 'org' | 'global' | 'rule'
  ];
  classify()(projection);

  const properties: Record<string, SchemaProperty> = {
    id: { type: 'uuid', primary: true },
  };
  if (host.scope === 'org') {
    properties['organizationId'] = { type: 'uuid', fieldName: 'organization_id' };
  }
  for (const column of resolved.columns) properties[column.key] = propertyOf(column);

  const schema = new EntitySchema({
    class: projection as never,
    tableName: declaration.host,
    properties: properties as never,
    // Research R-2: the decorator's filter does not reach an `EntitySchema`, so
    // the `org` filter is declared on the schema itself.
    ...(host.scope === 'org'
      ? {
          filters: {
            [ORG_FILTER]: { name: ORG_FILTER, cond: () => orgFilterCond(), default: true, args: false },
          },
        }
      : {}),
    hooks: {
      beforeCreate: [
        () => {
          throw new ExtensionProjectionWriteError(declaration.host, 'insert');
        },
      ],
      beforeDelete: [
        () => {
          throw new ExtensionProjectionWriteError(declaration.host, 'delete');
        },
      ],
    },
  } as never);

  built.set(declaration, { schema, facts: host });
  recordProjectionEntityName(declaration, entityName);
  return schema;
}

/** Every declaration's projection, plus the allowed-mapping set the duplicate-table rule reads. */
export function schemaExtensionProjections(
  declarations: readonly ColumnExtension[],
  entities: readonly EntityClassLike[],
): SchemaExtensionProjections {
  const schemas: EntitySchema[] = [];
  const allowed = new Map<string, Map<string, ReadonlySet<string>>>();
  for (const declaration of declarations) {
    const cached = built.get(declaration);
    const facts = cached?.facts ?? hostEntityFacts(entities, declaration);
    const schema = projectionSchemaOf(declaration, facts);
    schemas.push(schema);
    const perTable = allowed.get(declaration.host) ?? new Map<string, ReadonlySet<string>>();
    perTable.set(
      projectionEntityName(declaration),
      allowedPropertiesOf(resolvedColumnExtension(declaration), facts.scope),
    );
    allowed.set(declaration.host, perTable);
  }
  return { schemas, allowed };
}
