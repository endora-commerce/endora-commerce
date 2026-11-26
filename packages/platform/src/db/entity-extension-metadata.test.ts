import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { MikroORM, defineConfig, type MetadataStorage } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import {
  GlobalEntity,
  OrgScoped,
  RuleScoped,
  TransitivelyScoped,
} from '../tenancy/org-scoped.decorator.js';
import { ENTITY_EXTENSION_HOSTS } from '../kernel/schema-extensions/extensible-hosts.js';
import type { ResolvedEntityExtension } from '../kernel/entity-extensions/declarations.js';
import { EntityExtensionInvalidError } from '../kernel/entity-extensions/errors.js';
import { activeEntityExtensionContext } from '../kernel/entity-extensions/context.js';
import type { PackageSchemaContribution } from '../packages/package-runtime.js';
import { migrationOwnershipOf } from './configured-migrations.js';
import { mikroOrmConfigFrom } from './mikro-orm.config.js';
import {
  assertEntityExtensionMetadata,
  type EntityExtensionMetadataInputs,
  type EntityExtensionTableFacts,
} from './entity-extension-metadata.js';

/**
 * `specs/187-side-table-extensions/contracts/verification-rules.md` §2 – §3
 * (FR-003, FR-010 – FR-013; tasks.md T013, T023, T024) — the metadata rules,
 * over what MikroORM 7 **discovered** (an ORM initialised and never connected,
 * since v7 connects lazily, with the rule installed as `afterDiscovered` exactly
 * where `mikroOrmConfigFrom` chains it), never over decorators.
 */

// --- the hosts, named as the bindings name them ---------------------------

@GlobalEntity()
@Entity({ tableName: 'organizations' })
class Organization {
  @PrimaryKey({ type: 'uuid' })
  id!: string;
}

@OrgScoped()
@Entity({ tableName: 'customer_accounts' })
class CustomerAccount {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  organizationId!: string;
}

@OrgScoped()
@Entity({ tableName: 'orders' })
class Order {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  organizationId!: string;
}

@GlobalEntity()
@Entity({ tableName: 'products' })
class Product {
  @PrimaryKey({ type: 'uuid' })
  id!: string;
}

@RuleScoped()
@Entity({ tableName: 'projects' })
class Project {
  @PrimaryKey({ type: 'uuid' })
  id!: string;
}

/** A class of another name mapping a host table — what M0 refuses. */
@GlobalEntity()
@Entity({ tableName: 'organizations' })
class Company {
  @PrimaryKey({ type: 'uuid' })
  id!: string;
}

// --- side entities ---------------------------------------------------------

@GlobalEntity()
@Entity({ tableName: 'acme_links_organization_refs' })
class AcmeLinksOrganizationRef {
  @PrimaryKey({ type: 'uuid' })
  organizationId!: string;

  @Property({ type: 'text' })
  externalRef!: string;
}

/** The `QuoteRequestOrgPolicy` shape: `@OrgScoped` whose tenant key is the PK. */
@OrgScoped()
@Entity({ tableName: 'acme_links_org_policies' })
class AcmeLinksOrgPolicy {
  @PrimaryKey({ type: 'uuid' })
  organizationId!: string;
}

/** `@OrgScoped` on organizations, keyed by another column. */
@OrgScoped()
@Entity({ tableName: 'acme_links_org_keyed_elsewhere' })
class AcmeLinksOrgKeyedElsewhere {
  @PrimaryKey({ type: 'uuid' })
  hostId!: string;

  @Property({ type: 'uuid' })
  organizationId!: string;
}

/** The `QuoteRequestAccountPolicy` shape. */
@TransitivelyScoped('CustomerAccount', 'customerAccountId')
@Entity({ tableName: 'acme_links_account_policies' })
class AcmeLinksAccountPolicy {
  @PrimaryKey({ type: 'uuid' })
  customerAccountId!: string;
}

/** A copied `organization_id` on a side table of an org-scoped host — stale on a host move. */
@OrgScoped()
@Entity({ tableName: 'acme_links_account_copied' })
class AcmeLinksAccountCopied {
  @PrimaryKey({ type: 'uuid' })
  customerAccountId!: string;

  @Property({ type: 'uuid' })
  organizationId!: string;
}

/** A transitive parent naming another class than the host. */
@TransitivelyScoped('Order', 'customerAccountId')
@Entity({ tableName: 'acme_links_account_wrong_parent' })
class AcmeLinksAccountWrongParent {
  @PrimaryKey({ type: 'uuid' })
  customerAccountId!: string;
}

@TransitivelyScoped('Order', 'orderId')
@Entity({ tableName: 'acme_links_order_notes' })
class AcmeLinksOrderNote {
  @PrimaryKey({ type: 'uuid' })
  orderId!: string;
}

@GlobalEntity()
@Entity({ tableName: 'acme_links_product_refs' })
class AcmeLinksProductRef {
  @PrimaryKey({ type: 'uuid' })
  productId!: string;
}

@RuleScoped()
@Entity({ tableName: 'acme_links_product_ruled' })
class AcmeLinksProductRuled {
  @PrimaryKey({ type: 'uuid' })
  productId!: string;
}

@RuleScoped()
@Entity({ tableName: 'acme_links_project_refs' })
class AcmeLinksProjectRef {
  @PrimaryKey({ type: 'uuid' })
  projectId!: string;
}

@GlobalEntity()
@Entity({ tableName: 'acme_links_project_global' })
class AcmeLinksProjectGlobal {
  @PrimaryKey({ type: 'uuid' })
  projectId!: string;
}

@GlobalEntity()
@Entity({ tableName: 'acme_links_composite' })
class AcmeLinksComposite {
  @PrimaryKey({ type: 'uuid' })
  organizationId!: string;

  @PrimaryKey({ type: 'text' })
  kind!: string;
}

@GlobalEntity()
@Entity({ tableName: 'acme_links_varchar_key' })
class AcmeLinksVarcharKey {
  @PrimaryKey({ type: 'varchar', length: 36 })
  organizationId!: string;
}

/** Another module's entity on a table `acme_links` declares. */
@GlobalEntity()
@Entity({ tableName: 'acme_links_foreign' })
class OtherModuleRow {
  @PrimaryKey({ type: 'uuid' })
  organizationId!: string;
}

// --- harness ----------------------------------------------------------------

const HOST_CLASSES = [Organization, CustomerAccount, Order, Product, Project] as const;

const BASE_OWNERS: ReadonlyArray<readonly [string, readonly unknown[]]> = [
  ['organizations', [Organization]],
  ['customer_accounts', [CustomerAccount]],
  ['orders', [Order]],
  ['catalog', [Product]],
  ['projects', [Project]],
];

function extension(entity: string, table: string, moduleId = 'acme_links'): ResolvedEntityExtension {
  const host = ENTITY_EXTENSION_HOSTS.get(entity);
  if (host === undefined) throw new Error(`no host ${entity}`);
  return { moduleId, origin: 'package', declaration: { entity, table }, host };
}

interface Scenario {
  readonly side?: readonly (new () => object)[];
  readonly hosts?: readonly (new () => object)[];
  readonly extensions?: readonly ResolvedEntityExtension[];
  readonly otherModule?: readonly (new () => object)[];
}

/** Initialise an ORM (no connection) with the rule as `afterDiscovered`; resolve its answer or its refusal. */
async function discover(scenario: Scenario): Promise<EntityExtensionTableFacts> {
  const side = scenario.side ?? [];
  const other = scenario.otherModule ?? [];
  const inputs: EntityExtensionMetadataInputs = {
    extensions: scenario.extensions ?? [],
    entitiesByModule: new Map<string, readonly unknown[]>([
      ...BASE_OWNERS,
      ['acme_links', side],
      ['other_mod', other],
    ]),
    moduleOrigins: new Map([
      ...BASE_OWNERS.map(([moduleId]) => [moduleId, 'core'] as const),
      ['acme_links', 'package'] as const,
      ['other_mod', 'overlay'] as const,
    ]),
  };
  let facts: EntityExtensionTableFacts | undefined;
  const orm = await MikroORM.init(
    defineConfig({
      entities: [...(scenario.hosts ?? HOST_CLASSES), ...side, ...other],
      clientUrl: 'postgresql://unused:unused@localhost:5432/unused',
      discovery: {
        afterDiscovered: (storage: MetadataStorage) => {
          facts = assertEntityExtensionMetadata(storage, inputs);
        },
      },
    }),
  );
  await orm.close(true);
  if (facts === undefined) throw new Error('afterDiscovered did not run');
  return facts;
}

async function refusal(scenario: Scenario): Promise<EntityExtensionInvalidError> {
  try {
    await discover(scenario);
  } catch (error) {
    if (error instanceof EntityExtensionInvalidError) return error;
    throw error;
  }
  throw new Error('discovery was not refused');
}

// --- M0 and the happy path (T013) -------------------------------------------

describe('M0 — the bindings hold against discovered entities (FR-003)', () => {
  it('passes the real host class names, with no declaration at all', async () => {
    await expect(discover({})).resolves.toBeDefined();
  });

  it('refuses a binding whose table is mapped by a differently named class, even with no declaration', async () => {
    const error = await refusal({ hosts: [Company, CustomerAccount, Order, Product, Project] });
    expect(error.rule).toBe('host-binding-mismatch');
    expect(error.table).toBe('organizations');
    expect(error.entity).toBe('organizations.Organization');
    expect(error.message).toContain('"Company"');
  });

  it('says nothing about a host whose module is not composed (its table is mapped by nothing)', async () => {
    await expect(discover({ hosts: [Organization] })).resolves.toBeDefined();
  });
});

describe('a correct side entity passes and is reported (T013)', () => {
  it('accepts a @GlobalEntity side entity on organizations and names its owner and class', async () => {
    const facts = await discover({
      side: [AcmeLinksOrganizationRef],
      extensions: [extension('organizations.Organization', 'acme_links_organization_refs')],
    });
    expect(facts.get('acme_links_organization_refs')).toEqual({
      moduleId: 'acme_links',
      origin: 'package',
      className: 'AcmeLinksOrganizationRef',
    });
    expect(facts.get('organizations')).toEqual({ moduleId: 'organizations', origin: 'core', className: 'Organization' });
  });
});

// --- M1 – M4 (T023) ---------------------------------------------------------

describe('M1 – M4 — ownership and the key', () => {
  it('M1 refuses a declared table no entity maps', async () => {
    const error = await refusal({
      extensions: [extension('organizations.Organization', 'acme_links_nothing_maps')],
    });
    expect(error.rule).toBe('table-not-owned');
    expect(error.moduleId).toBe('acme_links');
    expect(error.table).toBe('acme_links_nothing_maps');
    expect(error.message).toContain('no entity maps it');
  });

  it('M2 refuses a declared table another module’s entity maps', async () => {
    const error = await refusal({
      otherModule: [OtherModuleRow],
      extensions: [extension('organizations.Organization', 'acme_links_foreign')],
    });
    expect(error.rule).toBe('table-not-owned');
    expect(error.message).toContain('"other_mod"');
  });

  it('M2 refuses a declared table whose entity no composed module owns', async () => {
    const error = await refusal({
      hosts: [...HOST_CLASSES, OtherModuleRow],
      extensions: [extension('organizations.Organization', 'acme_links_foreign')],
    });
    expect(error.rule).toBe('table-not-owned');
  });

  it('M3 refuses a two-property primary key', async () => {
    const error = await refusal({
      side: [AcmeLinksComposite],
      extensions: [extension('organizations.Organization', 'acme_links_composite')],
    });
    expect(error.rule).toBe('primary-key-not-single');
    expect(error.message).toContain('organizationId, kind');
  });

  it('M4 refuses a varchar primary key on a uuid host key', async () => {
    const error = await refusal({
      side: [AcmeLinksVarcharKey],
      extensions: [extension('organizations.Organization', 'acme_links_varchar_key')],
    });
    expect(error.rule).toBe('primary-key-type-mismatch');
    expect(error.message).toContain('varchar(36)');
    expect(error.message).toContain('uuid');
  });
});

// --- M5, one row per line of the tenancy table (T024) -----------------------

describe('M5 — the side entity follows its host’s tenancy (verification-rules.md §3, OR-9)', () => {
  it.each([
    ['organizations', '@GlobalEntity', AcmeLinksOrganizationRef, 'organizations.Organization'],
    ['organizations', '@OrgScoped keyed by the PK (QuoteRequestOrgPolicy)', AcmeLinksOrgPolicy, 'organizations.Organization'],
    [
      'customer_accounts',
      "@TransitivelyScoped('CustomerAccount', '<pk>') (QuoteRequestAccountPolicy)",
      AcmeLinksAccountPolicy,
      'customer_accounts.CustomerAccount',
    ],
    ['orders', "@TransitivelyScoped('Order', 'orderId')", AcmeLinksOrderNote, 'orders.Order'],
    ['products', '@GlobalEntity', AcmeLinksProductRef, 'catalog.Product'],
    ['projects', '@RuleScoped', AcmeLinksProjectRef, 'projects.Project'],
  ] as const)('accepts on %s: %s', async (_host, _form, cls, entity) => {
    const facts = await discover({ side: [cls], extensions: [extension(entity, tableOf(cls))] });
    expect(facts.get(tableOf(cls))?.moduleId).toBe('acme_links');
  });

  it.each([
    ['organizations', '@OrgScoped keyed by another column', AcmeLinksOrgKeyedElsewhere, 'organizations.Organization', '@GlobalEntity()'],
    [
      'customer_accounts',
      '@OrgScoped with a copied organization_id',
      AcmeLinksAccountCopied,
      'customer_accounts.CustomerAccount',
      "@TransitivelyScoped('CustomerAccount', 'customerAccountId')",
    ],
    [
      'customer_accounts',
      'a transitive parent naming another class',
      AcmeLinksAccountWrongParent,
      'customer_accounts.CustomerAccount',
      "@TransitivelyScoped('CustomerAccount', 'customerAccountId')",
    ],
    ['products', '@RuleScoped', AcmeLinksProductRuled, 'catalog.Product', '@GlobalEntity()'],
    ['projects', '@GlobalEntity', AcmeLinksProjectGlobal, 'projects.Project', '@RuleScoped()'],
  ] as const)('refuses on %s: %s, naming the admitted form', async (_host, _form, cls, entity, admitted) => {
    const error = await refusal({ side: [cls], extensions: [extension(entity, tableOf(cls))] });
    expect(error.rule).toBe('tenancy-mismatch');
    expect(error.message).toContain(admitted);
    expect(error.message).toContain(tableOf(cls));
  });

  it('explains why a copied tenant key is refused on an org-scoped host', async () => {
    const error = await refusal({
      side: [AcmeLinksAccountCopied],
      extensions: [extension('customer_accounts.CustomerAccount', 'acme_links_account_copied')],
    });
    expect(error.message).toContain('customer_accounts (@OrgScoped)');
    expect(error.message).toContain('goes stale when the host moves');
  });
});

function tableOf(cls: unknown): string {
  const map: ReadonlyMap<unknown, string> = new Map<unknown, string>([
    [AcmeLinksOrganizationRef, 'acme_links_organization_refs'],
    [AcmeLinksOrgPolicy, 'acme_links_org_policies'],
    [AcmeLinksOrgKeyedElsewhere, 'acme_links_org_keyed_elsewhere'],
    [AcmeLinksAccountPolicy, 'acme_links_account_policies'],
    [AcmeLinksAccountCopied, 'acme_links_account_copied'],
    [AcmeLinksAccountWrongParent, 'acme_links_account_wrong_parent'],
    [AcmeLinksOrderNote, 'acme_links_order_notes'],
    [AcmeLinksProductRef, 'acme_links_product_refs'],
    [AcmeLinksProductRuled, 'acme_links_product_ruled'],
    [AcmeLinksProjectRef, 'acme_links_project_refs'],
    [AcmeLinksProjectGlobal, 'acme_links_project_global'],
  ]);
  const table = map.get(cls);
  if (table === undefined) throw new Error('unmapped fixture class');
  return table;
}

// --- the configuration chains it (T014) -------------------------------------

describe('mikroOrmConfigFrom — the side-table rules run in every ORM initialisation', () => {
  function migrationsWith(packages: readonly PackageSchemaContribution[], resolved?: readonly ResolvedEntityExtension[]) {
    return {
      migrations: [],
      registered: [],
      names: [],
      diagnostics: [],
      ownership: migrationOwnershipOf([], []),
      packages,
      overlays: [],
      ...(resolved === undefined ? {} : { entityExtensions: resolved }),
    };
  }
  const acmeLinks = (entities: readonly (new () => object)[]): PackageSchemaContribution => ({
    id: 'acme_links',
    packageName: '@acme/mod-acme-links',
    version: '1.0.0',
    migrationsDirectory: null,
    migrations: [],
    entities,
    dependencies: ['organizations'],
    schemaExtensions: [],
  });

  async function init(config: ReturnType<typeof mikroOrmConfigFrom>): Promise<void> {
    const orm = await MikroORM.init(config);
    await orm.close(true);
  }

  it('records the resolved declarations and, after discovery, who maps each table', async () => {
    const resolved = [extension('organizations.Organization', 'acme_links_organization_refs')];
    const config = mikroOrmConfigFrom({
      entities: [Organization, AcmeLinksOrganizationRef],
      migrations: migrationsWith([acmeLinks([AcmeLinksOrganizationRef])], resolved),
      coreEntityOwners: [['organizations', [Organization]]],
    });
    expect(activeEntityExtensionContext()).toEqual({ extensions: resolved, tables: null });
    await init(config);
    const { tables } = activeEntityExtensionContext();
    expect(tables?.get('acme_links_organization_refs')).toEqual({
      moduleId: 'acme_links',
      origin: 'package',
      className: 'AcmeLinksOrganizationRef',
    });
    expect(tables?.get('organizations')).toEqual({ moduleId: 'organizations', origin: 'core', className: 'Organization' });
  });

  it('refuses the initialisation on a metadata rule (M5), after D2’s rule', async () => {
    const config = mikroOrmConfigFrom({
      entities: [CustomerAccount, AcmeLinksAccountCopied],
      migrations: migrationsWith(
        [acmeLinks([AcmeLinksAccountCopied])],
        [extension('customer_accounts.CustomerAccount', 'acme_links_account_copied')],
      ),
      coreEntityOwners: [['customer_accounts', [CustomerAccount]]],
    });
    await expect(init(config)).rejects.toMatchObject({ name: 'EntityExtensionInvalidError', rule: 'tenancy-mismatch' });
  });

  it('holds M0 with nothing declared', async () => {
    const config = mikroOrmConfigFrom({ entities: [Company], migrations: migrationsWith([]) });
    await expect(init(config)).rejects.toMatchObject({ rule: 'host-binding-mismatch' });
  });
});
