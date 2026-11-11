import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { GlobalEntity } from '../tenancy/org-scoped.decorator.js';
import { createColumnExtension } from '../kernel/schema-extensions/define.js';
import { schemaExtensionProjections } from './schema-extension-projection.js';
import { assertTableMappings, schemaExtensionDiscovery } from './table-mapping-rule.js';
import { DuplicateTableMappingError } from '../kernel/schema-extensions/errors.js';

/**
 * `specs/178-extensible-columns/` FR-031, research R-1 / R-3 — the port of the
 * spike, with no database (`connect: false`).
 *
 * MikroORM refuses two entities on one table by default. The platform turns that
 * check off only together with a rule of its own, which lets through exactly the
 * projections it built for validated declarations and refuses every other second
 * mapping by name.
 */

@GlobalEntity()
@Entity({ tableName: 'x178_rule_hosts' })
class X178RuleHost {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'text' })
  name!: string;
}

@GlobalEntity()
@Entity({ tableName: 'x178_rule_hosts' })
class X178RogueMapping {
  @PrimaryKey({ type: 'uuid' })
  id!: string;
}

const hosts = new Set(['x178_rule_hosts']);
const declaration = createColumnExtension(
  {
    host: 'x178_rule_hosts',
    module: 'acme_erp',
    columns: {
      erpCode: { type: 'varchar', length: 64, nullable: true, index: 'unique' },
      creditTier: { type: 'smallint', default: 0 },
    },
  },
  hosts,
);

async function init(options: {
  entities: unknown[];
  discovery?: Parameters<typeof MikroORM.init>[0] extends infer O
    ? O extends { discovery?: infer D }
      ? D
      : never
    : never;
}): Promise<MikroORM> {
  return MikroORM.init({
    entities: options.entities as never[],
    dbName: 'x178_never_connected',
    connect: false,
    allowGlobalContext: true,
    ...(options.discovery === undefined ? {} : { discovery: options.discovery }),
  });
}

describe('the duplicate-table rule', () => {
  it('MikroORM refuses the projection under default discovery', async () => {
    const projections = schemaExtensionProjections([declaration], [X178RuleHost]);
    await expect(init({ entities: [X178RuleHost, ...projections.schemas] })).rejects.toThrow(
      /Duplicate table names/,
    );
  });

  it('admits the declared projection when the rule is installed', async () => {
    const projections = schemaExtensionProjections([declaration], [X178RuleHost]);
    const orm = await init({
      entities: [X178RuleHost, ...projections.schemas],
      discovery: schemaExtensionDiscovery(projections.allowed),
    });
    const names = Object.values(orm.getMetadata().getAll())
      .filter((meta) => meta.tableName === 'x178_rule_hosts')
      .map((meta) => meta.className)
      .sort();
    expect(names).toEqual(['X178RuleHost', '__x_acme_erp__x178_rule_hosts']);
    await orm.close();
  });

  it('refuses an undeclared second mapping, naming both classes', async () => {
    const projections = schemaExtensionProjections([declaration], [X178RuleHost]);
    const error = await init({
      entities: [X178RuleHost, X178RogueMapping, ...projections.schemas],
      discovery: schemaExtensionDiscovery(projections.allowed),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DuplicateTableMappingError);
    expect((error as Error).message).toContain('X178RuleHost');
    expect((error as Error).message).toContain('X178RogueMapping');
  });

  it('refuses a projection whose properties exceed the declaration', async () => {
    const projections = schemaExtensionProjections([declaration], [X178RuleHost]);
    const narrowed = new Map([
      ['x178_rule_hosts', new Map([['__x_acme_erp__x178_rule_hosts', new Set(['id', 'erpCode'])]])],
    ]);
    const error = await init({
      entities: [X178RuleHost, ...projections.schemas],
      discovery: schemaExtensionDiscovery(narrowed),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DuplicateTableMappingError);
    expect((error as Error).message).toContain('creditTier');
  });

  it('turns the MikroORM check off only together with the rule', () => {
    const discovery = schemaExtensionDiscovery(new Map());
    expect(discovery.checkDuplicateTableNames).toBe(false);
    expect(typeof discovery.afterDiscovered).toBe('function');
  });

  it('refuses two core entities on one table with no projection involved', () => {
    const storage = {
      getAll: () => ({
        A: { className: 'A', tableName: 't', root: undefined, properties: {} },
        B: { className: 'B', tableName: 't', root: undefined, properties: {} },
      }),
    };
    expect(() => assertTableMappings(storage as never, new Map())).toThrow(DuplicateTableMappingError);
  });
});
