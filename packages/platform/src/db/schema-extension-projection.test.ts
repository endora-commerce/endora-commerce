import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { GlobalEntity, OrgScoped, RuleScoped, tenantClassifications } from '../tenancy/org-scoped.decorator.js';
import { createColumnExtension } from '../kernel/schema-extensions/define.js';
import { ExtensionProjectionWriteError } from '../kernel/schema-extensions/errors.js';
import { projectionEntityNameOf } from '../kernel/schema-extensions/registry.js';
import { schemaExtensionProjections } from './schema-extension-projection.js';
import { schemaExtensionDiscovery } from './table-mapping-rule.js';

/**
 * `specs/178-extensible-columns/` FR-030, FR-032; research R-2 — the projection
 * carries the host's tenant classification in **both** places: the registry the
 * write guard and the checks read, and the schema's own `filters`, because a
 * decorator applied to a class that is then used as an `EntitySchema` does not
 * reach the query.
 */

@OrgScoped()
@Entity({ tableName: 'x178_org_hosts' })
class X178OrgHost {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  organizationId!: string;
}

@GlobalEntity()
@Entity({ tableName: 'x178_global_hosts' })
class X178GlobalHost {
  @PrimaryKey({ type: 'uuid' })
  id!: string;
}

@RuleScoped()
@Entity({ tableName: 'x178_rule_scoped_hosts' })
class X178RuleScopedHost {
  @PrimaryKey({ type: 'uuid' })
  id!: string;
}

const hosts = new Set(['x178_org_hosts', 'x178_global_hosts', 'x178_rule_scoped_hosts']);
const declare = (host: string) =>
  createColumnExtension(
    { host, module: 'acme_erp', columns: { erpCode: { type: 'text', nullable: true } } },
    hosts,
  );
const onOrg = declare('x178_org_hosts');
const onGlobal = declare('x178_global_hosts');
const onRule = declare('x178_rule_scoped_hosts');
const entities = [X178OrgHost, X178GlobalHost, X178RuleScopedHost];

async function orm(): Promise<MikroORM> {
  const projections = schemaExtensionProjections([onOrg, onGlobal, onRule], entities);
  return MikroORM.init({
    entities: [...entities, ...projections.schemas],
    dbName: 'x178_never_connected',
    connect: false,
    allowGlobalContext: true,
    discovery: schemaExtensionDiscovery(projections.allowed),
  });
}

function scopeOf(entityName: string): string | undefined {
  return tenantClassifications().find((row) => row.className === entityName)?.scope;
}

describe('schema-extension projection', () => {
  it('maps the PK, the tenant key of an org-scoped host and the declared columns', async () => {
    const o = await orm();
    const meta = o.getMetadata().get(projectionEntityNameOf(onOrg));
    expect(meta.tableName).toBe('x178_org_hosts');
    expect(Object.keys(meta.properties).sort()).toEqual(['erpCode', 'id', 'organizationId']);
    expect(meta.properties['erpCode' as never]!.fieldNames).toEqual(['x_acme_erp_erp_code']);
    const global = o.getMetadata().get(projectionEntityNameOf(onGlobal));
    expect(Object.keys(global.properties).sort()).toEqual(['erpCode', 'id']);
    await o.close();
  });

  it('carries filters.org on the schema of an org-scoped host, and registers it as org', async () => {
    const o = await orm();
    const meta = o.getMetadata().get(projectionEntityNameOf(onOrg));
    expect(meta.filters['org']).toMatchObject({ name: 'org', default: true });
    expect(scopeOf(projectionEntityNameOf(onOrg))).toBe('org');
    await o.close();
  });

  it('copies GlobalEntity and RuleScoped, with no filter', async () => {
    const o = await orm();
    expect(scopeOf(projectionEntityNameOf(onGlobal))).toBe('global');
    expect(scopeOf(projectionEntityNameOf(onRule))).toBe('rule');
    expect(o.getMetadata().get(projectionEntityNameOf(onGlobal)).filters['org']).toBeUndefined();
    await o.close();
  });

  it('refuses insert and delete through entity hooks', async () => {
    const o = await orm();
    const meta = o.getMetadata().get(projectionEntityNameOf(onOrg));
    const [beforeCreate] = meta.hooks.beforeCreate ?? [];
    const [beforeDelete] = meta.hooks.beforeDelete ?? [];
    expect(() => (beforeCreate as () => void)()).toThrow(ExtensionProjectionWriteError);
    expect(() => (beforeDelete as () => void)()).toThrow(ExtensionProjectionWriteError);
    await o.close();
  });

  it('leaves the core entity blind to the extension columns', async () => {
    const o = await orm();
    const core = o.getMetadata().get('X178OrgHost');
    expect(Object.keys(core.properties).some((p) => p.startsWith('x_'))).toBe(false);
    expect(Object.values(core.properties).some((p) => p.fieldNames?.[0]?.startsWith('x_'))).toBe(false);
    await o.close();
  });

  it('builds one projection per declaration, memoised by identity', () => {
    const first = schemaExtensionProjections([onOrg], entities).schemas[0];
    const second = schemaExtensionProjections([onOrg], entities).schemas[0];
    expect(first).toBe(second);
  });
});
