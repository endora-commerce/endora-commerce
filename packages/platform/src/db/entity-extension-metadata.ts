import type { MetadataStorage } from '@mikro-orm/core';
import { tenantClassifications, type ClassificationMeta } from '../tenancy/org-scoped.decorator.js';
import {
  ENTITY_EXTENSION_HOSTS,
  type EntityExtensionHost,
} from '../kernel/schema-extensions/extensible-hosts.js';
import type { ResolvedEntityExtension } from '../kernel/entity-extensions/declarations.js';
import {
  EntityExtensionInvalidError,
  type EntityExtensionOrigin,
  type EntityExtensionRule,
} from '../kernel/entity-extensions/errors.js';
import type {
  EntityExtensionTableFacts,
  EntityExtensionTableOwner,
} from '../kernel/entity-extensions/context.js';
import { allMetadata } from './all-metadata.js';

/**
 * The **metadata** rules of side-table extensions
 * (`specs/187-side-table-extensions/contracts/verification-rules.md` §2 – §3;
 * FR-003, FR-010 – FR-013; research R-4).
 *
 * Run in `discovery.afterDiscovered`, after D2's table-mapping rule, so every
 * ORM initialisation the platform performs — `migrate`, boot, lifecycle
 * `install` — refuses before a query is issued. The facts are what MikroORM 7
 * **discovered** (`getAll()` is a `Map`; read through {@link allMetadata}), and
 * the classification is the tenancy registry's, matched by class identity —
 * never decorator metadata, which v7 no longer exposes and which a
 * `defineEntity` schema would not carry.
 *
 * - **M0** `host-binding-mismatch` — always, declaration or not: the entity
 *   mapping a binding's table must be the class the binding names.
 * - **M1 / M2** `table-not-owned` — a declared table is mapped by an entity of
 *   the declaring module, and only by one.
 * - **M3** `primary-key-not-single`, **M4** `primary-key-type-mismatch`.
 * - **M5** `tenancy-mismatch` / `host-scope-not-offered` — the side entity's
 *   classification is one its host's admits (owner ruling OR-9).
 */

export interface EntityExtensionMetadataInputs {
  /** The declarations that passed E1 – E5. */
  readonly extensions: readonly ResolvedEntityExtension[];
  /**
   * Module id → the entity classes it contributes — who owns a table. A class
   * in none of them is owned by no composed module (and so cannot carry a
   * declared side table: M2 fails closed).
   */
  readonly entitiesByModule: ReadonlyMap<string, readonly unknown[]>;
  /** Module id → where it came from, for the facts the list prints. Absent: `null`. */
  readonly moduleOrigins?: ReadonlyMap<string, EntityExtensionOrigin>;
  /**
   * Class names of D2 projections per table (`AllowedProjections`' keys): a
   * projection shares its host's table by design and is not the host's entity.
   */
  readonly projections?: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  /** Defaults to the tenancy registry. */
  readonly classifications?: readonly ClassificationMeta[];
  /** Defaults to every extensible host — what M0 holds. */
  readonly hosts?: ReadonlyMap<string, EntityExtensionHost>;
}

export type { EntityExtensionTableFacts, EntityExtensionTableOwner };

interface PropertyLike {
  readonly type?: unknown;
  readonly columnTypes?: readonly string[];
}

interface MetaLike {
  readonly class?: unknown;
  readonly className: string;
  readonly tableName?: string;
  readonly collection?: string;
  readonly abstract?: boolean;
  readonly embeddable?: boolean;
  readonly virtual?: boolean;
  readonly root?: unknown;
  readonly primaryKeys?: readonly string[];
  readonly properties: Record<string, PropertyLike | undefined>;
}

/** The scope a side entity carries, as the tenancy registry recorded it. */
function classificationOf(meta: MetaLike, classifications: readonly ClassificationMeta[]): ClassificationMeta | undefined {
  return classifications.find((entry) => (entry.target as unknown) === meta.class);
}

function columnTypeOf(property: PropertyLike | undefined): string {
  const declared = property?.columnTypes?.[0] ?? (typeof property?.type === 'string' ? property.type : undefined);
  return (declared ?? 'unknown').toLowerCase();
}

function decoratorOf(classification: ClassificationMeta | undefined): string {
  if (classification === undefined) return 'no tenancy classification';
  switch (classification.scope) {
    case 'global':
      return '@GlobalEntity()';
    case 'org':
      return '@OrgScoped()';
    case 'customer':
      return '@CustomerScoped()';
    case 'rule':
      return '@RuleScoped()';
    case 'transitive':
      return `@TransitivelyScoped('${classification.parentClassName ?? '?'}', '${classification.fk ?? '?'}')`;
  }
}

/**
 * The admitted forms for a host, and whether `side` is one of them
 * (`verification-rules.md` §3). `null` when the host's scope offers none.
 */
function admitted(
  host: EntityExtensionHost,
  hostScope: ClassificationMeta['scope'] | undefined,
  pkProperty: string,
  side: ClassificationMeta | undefined,
): { readonly forms: string; readonly ok: boolean; readonly why: string } | null {
  switch (hostScope) {
    case 'global':
      if (host.table === 'organizations') {
        return {
          forms: `@GlobalEntity(), or @OrgScoped() whose tenant key is its primary key "${pkProperty}"`,
          ok: side?.scope === 'global' || (side?.scope === 'org' && side.key === pkProperty),
          why: 'its tenant is the organization it is keyed by',
        };
      }
      return {
        forms: '@GlobalEntity()',
        ok: side?.scope === 'global',
        why: 'its host is global, so it carries no tenant of its own',
      };
    case 'org':
      return {
        forms: `@TransitivelyScoped('${host.entityClassName}', '${pkProperty}')`,
        ok:
          side?.scope === 'transitive' && side.parentClassName === host.entityClassName && side.fk === pkProperty,
        why: 'its tenant is its host\'s, and a copied organization_id goes stale when the host moves',
      };
    case 'rule':
      return {
        forms: '@RuleScoped()',
        ok: side?.scope === 'rule',
        why: 'it is read under its host\'s rule; a transitive chain to a rule host grounds nowhere (D-170)',
      };
    default:
      return null;
  }
}

/**
 * Refuse — throwing {@link EntityExtensionInvalidError} — the first metadata
 * rule a host binding or a declaration breaks; answer who maps each table.
 */
export function assertEntityExtensionMetadata(
  storage: MetadataStorage | { getAll(): Map<unknown, unknown> | Record<string, unknown> },
  inputs: EntityExtensionMetadataInputs,
): EntityExtensionTableFacts {
  const classifications = inputs.classifications ?? tenantClassifications();
  const hosts = inputs.hosts ?? ENTITY_EXTENSION_HOSTS;

  const ownerOfClass = new Map<unknown, string>();
  for (const [moduleId, classes] of inputs.entitiesByModule) {
    for (const cls of classes) if (!ownerOfClass.has(cls)) ownerOfClass.set(cls, moduleId);
  }

  // table → its owning entity: one per table, a D2 projection excepted.
  const byTable = new Map<string, MetaLike>();
  for (const meta of allMetadata(storage as { getAll(): Map<unknown, MetaLike> }) as MetaLike[]) {
    if (meta.abstract || meta.embeddable || meta.virtual) continue;
    if (meta.root !== undefined && meta.root !== meta) continue;
    const table = meta.tableName ?? meta.collection;
    if (table === undefined) continue;
    if (inputs.projections?.get(table)?.has(meta.className)) continue;
    if (!byTable.has(table)) byTable.set(table, meta);
  }

  const facts = new Map<string, EntityExtensionTableOwner>();
  for (const [table, meta] of byTable) {
    const moduleId = ownerOfClass.get(meta.class) ?? null;
    facts.set(table, {
      moduleId,
      origin: moduleId === null ? null : (inputs.moduleOrigins?.get(moduleId) ?? null),
      className: meta.className,
    });
  }

  // M0 — every binding, always. A host table no entity maps is a composition
  // without that host's module, which is not a mismatch.
  for (const [entity, host] of hosts) {
    const meta = byTable.get(host.table);
    if (meta === undefined || meta.className === host.entityClassName) continue;
    throw new EntityExtensionInvalidError({
      rule: 'host-binding-mismatch',
      moduleId: null,
      origin: null,
      table: host.table,
      entity,
      detail:
        `the custom-field host binding names class "${host.entityClassName}" for table "${host.table}", but the ` +
        `entity mapping it is "${meta.className}"; the entity is right and the binding in ` +
        '@endora-commerce/contracts CUSTOM_FIELD_HOST_BINDINGS is the defect',
    });
  }

  for (const extension of inputs.extensions) {
    const { moduleId, origin, declaration, host } = extension;
    const refuse = (rule: EntityExtensionRule, detail: string): never => {
      throw new EntityExtensionInvalidError({
        rule,
        moduleId,
        origin,
        table: declaration.table,
        entity: declaration.entity,
        detail,
      });
    };

    // M1 / M2 — the declaring module's own entity maps the table.
    const meta = byTable.get(declaration.table);
    if (meta === undefined) {
      refuse(
        'table-not-owned',
        `no entity maps it; add the "${moduleId}" entity that maps "${declaration.table}" to the module's ` +
          'entities, or remove the declaration',
      );
    }
    const side = meta as MetaLike;
    const owner = ownerOfClass.get(side.class);
    if (owner !== moduleId) {
      refuse(
        'table-not-owned',
        owner === undefined
          ? `it is mapped by "${side.className}", which no composed module contributes; a side table is mapped ` +
              `by an entity of the declaring module`
          : `it is mapped by "${side.className}" of module "${owner}"; a module declares only its own tables`,
      );
    }

    // M3 — exactly one primary-key property.
    const keys = side.primaryKeys ?? [];
    if (keys.length !== 1) {
      refuse(
        'primary-key-not-single',
        `its entity "${side.className}" has ${keys.length === 0 ? 'no' : keys.length} primary-key ` +
          `propert${keys.length === 1 ? 'y' : 'ies'} (${keys.join(', ')}); a side table is keyed by exactly one ` +
          `column, the host's id`,
      );
    }
    const pkProperty = keys[0]!;

    // M4 — of the host primary key's type.
    const hostMeta = byTable.get(host.table);
    const hostKey = hostMeta?.primaryKeys?.length === 1 ? hostMeta.properties[hostMeta.primaryKeys[0]!] : undefined;
    const expectedType = hostKey === undefined ? 'uuid' : columnTypeOf(hostKey);
    const actualType = columnTypeOf(side.properties[pkProperty]);
    if (actualType !== expectedType) {
      refuse(
        'primary-key-type-mismatch',
        `its primary key "${pkProperty}" is ${actualType}, but ${host.table}'s primary key is ${expectedType}; ` +
          `declare it @PrimaryKey({ type: '${expectedType}' })`,
      );
    }

    // M5 — the classification follows the host's (OR-9).
    const hostClassification = hostMeta === undefined ? undefined : classificationOf(hostMeta, classifications);
    const sideClassification = classificationOf(side, classifications);
    const rule = admitted(host, hostClassification?.scope, pkProperty, sideClassification);
    if (rule === null) {
      refuse(
        'host-scope-not-offered',
        `${host.table} is ${decoratorOf(hostClassification)}; no side-table classification is offered for a ` +
          'host of that scope yet',
      );
    }
    const verdict = rule as NonNullable<typeof rule>;
    if (!verdict.ok) {
      refuse(
        'tenancy-mismatch',
        `${declaration.table} is ${decoratorOf(sideClassification)}; a side table of ${host.table} ` +
          `(${decoratorOf(hostClassification).replace('()', '')}) must be ${verdict.forms}: ${verdict.why}`,
      );
    }
  }
  return facts;
}
