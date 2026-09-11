import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  coreModuleRoot,
  deriveFkGraph,
  FkGraphRootError,
  type ModuleRoot,
} from '../../helpers/fk-graph.js';

/**
 * Derivation cases D1-D8 of
 * specs/065-manifest-aware-migrations/contracts/fk-dependency-check.md §5.
 *
 * Fixture-driven only: every case builds a throwaway `src/` tree on disk, so
 * nothing here depends on the real repository. No database, no ORM.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fk-graph-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes `src/modules/<moduleId>/entities/<table>.entity.ts` for each table. */
function entities(moduleId: string, ...tables: string[]): void {
  const dir = join(root, 'modules', moduleId, 'entities');
  mkdirSync(dir, { recursive: true });
  for (const table of tables) {
    writeFileSync(
      join(dir, `${table}.entity.ts`),
      `import { Entity } from '@mikro-orm/core';\n` +
        `@Entity({ tableName: '${table}' })\n` +
        `export class Some {}\n`,
      'utf8',
    );
  }
}

/** Writes `src/modules/<moduleId>/migrations/<name>.ts` carrying `sql`. */
function migration(moduleId: string, name: string, sql: string): void {
  const dir = join(root, 'modules', moduleId, 'migrations');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.ts`),
    `import { Migration } from '@mikro-orm/migrations';\n` +
      `export class X extends Migration {\n` +
      `  override async up(): Promise<void> {\n` +
      `    this.addSql(\`${sql}\`);\n` +
      `  }\n` +
      `}\n`,
    'utf8',
  );
}

function edgeKeys(graph: ReturnType<typeof deriveFkGraph>): string[] {
  return graph.edges.map((edge) => `${edge.from}→${edge.to}`).sort();
}

describe('deriveFkGraph — D1 inline column reference', () => {
  it('yields an edge from the created table owner to the referenced table owner', () => {
    entities('orders', 'orders');
    entities('organizations', 'organizations');
    migration(
      'orders',
      '20260901T090000_orders_init',
      `create table "orders" (
         "id" uuid not null,
         "organization_id" uuid not null references "organizations" ("id") on update cascade,
         constraint "orders_pkey" primary key ("id")
       );`,
    );

    const graph = deriveFkGraph(root);

    expect(edgeKeys(graph)).toEqual(['orders→organizations']);
    expect(graph.edges[0]!.via).toEqual(['orders → organizations']);
    expect(graph.edges[0]!.count).toBe(1);
  });
});

describe('deriveFkGraph — D2 alter table add constraint', () => {
  it('yields the same edge as an inline reference', () => {
    entities('orders', 'orders');
    entities('organizations', 'organizations');
    migration(
      'orders',
      '20260901T090000_orders_org',
      `alter table "orders" add constraint "orders_org_fk" foreign key ("organization_id")
         references "organizations" ("id") on update cascade on delete restrict;`,
    );

    const graph = deriveFkGraph(root);

    expect(edgeKeys(graph)).toEqual(['orders→organizations']);
  });
});

describe('deriveFkGraph — D3 intra-module reference', () => {
  it('yields no edge', () => {
    entities('orders', 'orders', 'order_items');
    migration(
      'orders',
      '20260901T090000_orders_items',
      `create table "order_items" (
         "id" uuid not null,
         "order_id" uuid not null references "orders" ("id")
       );`,
    );

    const graph = deriveFkGraph(root);

    expect(graph.edges).toEqual([]);
    expect(graph.unresolvedReferences).toEqual([]);
  });
});

describe('deriveFkGraph — D4 several references in one statement', () => {
  it('records every edge with its own via entry', () => {
    entities('carts', 'carts');
    entities('organizations', 'organizations');
    entities('sales_channels', 'sales_channels');
    migration(
      'carts',
      '20260901T090000_carts_init',
      `create table "carts" (
         "id" uuid not null,
         "organization_id" uuid null references "organizations" ("id"),
         "sales_channel_id" uuid null references "sales_channels" ("id")
       );`,
    );

    const graph = deriveFkGraph(root);

    expect(edgeKeys(graph)).toEqual(['carts→organizations', 'carts→sales_channels']);
    for (const edge of graph.edges) {
      expect(edge.via).toEqual([`carts → ${edge.to}`]);
    }
  });
});

describe('deriveFkGraph — D5 statement scoping regression', () => {
  it('produces no phantom reference from prose or unrelated SQL', () => {
    entities('orders', 'orders');
    entities('catalog', 'products');
    // `extends`/`with` in the surrounding TypeScript and a `references` word in
    // a comment outside any create/alter table body must contribute nothing.
    const dir = join(root, 'modules', 'orders', 'migrations');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '20260901T090000_orders_prose.ts'),
      `import { Migration } from '@mikro-orm/migrations';\n` +
        `// This migration references "products" only in prose.\n` +
        `export class X extends Migration {\n` +
        `  override async up(): Promise<void> {\n` +
        `    this.addSql(\`create table "orders" ("id" uuid not null);\`);\n` +
        `    this.addSql(\`with recent as (select 1) update "orders" set "id" = "id" from recent;\`);\n` +
        `    this.addSql(\`comment on table "orders" is 'references "products" historically';\`);\n` +
        `  }\n` +
        `}\n`,
      'utf8',
    );

    const graph = deriveFkGraph(root);

    expect(graph.edges).toEqual([]);
    expect(graph.unresolvedReferences).toEqual([]);
  });
});

describe('deriveFkGraph — statements assembled from concatenated template literals', () => {
  it('sees a foreign key split across a `…` + `…` join', () => {
    entities('stripe', 'stripe_payment_method_rules');
    entities('payment_methods', 'payment_methods');
    const dir = join(root, 'modules', 'stripe', 'migrations');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '20260901T090000_stripe_init.ts'),
      `import { Migration } from '@mikro-orm/migrations';\n` +
        `export class X extends Migration {\n` +
        `  override async up(): Promise<void> {\n` +
        `    this.addSql(\n` +
        `      \`alter table "stripe_payment_method_rules" \` +\n` +
        `        \`add constraint "r_fk" \` +\n` +
        `        \`foreign key ("payment_method_id") references "payment_methods" ("id");\`,\n` +
        `    );\n` +
        `  }\n` +
        `}\n`,
      'utf8',
    );

    const graph = deriveFkGraph(root);

    expect(edgeKeys(graph)).toEqual(['stripe→payment_methods']);
  });
});

describe('deriveFkGraph — D6 unresolvable referenced table', () => {
  it('reports the reference, naming both tables', () => {
    entities('orders', 'orders');
    migration(
      'orders',
      '20260901T090000_orders_ghost',
      `create table "orders" ("id" uuid not null references "ghost_table" ("id"));`,
    );

    const graph = deriveFkGraph(root);

    expect(graph.unresolvedReferences).toEqual(['orders → ghost_table']);
    expect(graph.edges).toEqual([]);
  });
});

describe('deriveFkGraph — D7 entity ownership beats an override', () => {
  it('prefers the entity declaration', () => {
    entities('catalog', 'products');
    migration('catalog', '20260901T090000_catalog_init', `create table "products" ("id" uuid);`);

    const graph = deriveFkGraph(root, { overrides: { products: 'sales_channels' } });

    expect(graph.owners.get('products')).toBe('catalog');
    expect(graph.entityOwners.get('products')).toBe('catalog');
  });

  it('falls back to the override when no entity claims the table', () => {
    entities('catalog', 'products');
    migration(
      'sales_channels',
      '20260901T090000_sales_channels_bridge',
      `create table "sales_channel_products" (
         "product_id" uuid not null references "products" ("id")
       );`,
    );

    const graph = deriveFkGraph(root, {
      overrides: { sales_channel_products: 'sales_channels' },
    });

    expect(graph.owners.get('sales_channel_products')).toBe('sales_channels');
    expect(graph.unownedTables).toEqual([]);
    expect(edgeKeys(graph)).toEqual(['sales_channels→catalog']);
  });
});

describe('deriveFkGraph — D8 created table with no owner', () => {
  it('reports the table instead of guessing from the creating migration', () => {
    entities('catalog', 'products');
    migration(
      'catalog',
      '20260901T090000_catalog_bridge',
      `create table "mystery_bridge" ("product_id" uuid not null references "products" ("id"));`,
    );

    const graph = deriveFkGraph(root);

    expect(graph.unownedTables).toEqual(['mystery_bridge']);
    // The unowned table cannot contribute an edge — its `from` is unknown.
    expect(graph.edges).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Feature 080, T013 — where the scan looks, and what it does when the tree is
 * not there.
 *
 * Every fixture below is a tree on disk read by `deriveFkGraph` itself: the
 * refusal is at the very top of the analysis, so a proof that entered under it
 * would be proving nothing about the case it exists for (issue #130).
 * ──────────────────────────────────────────────────────────────────────────── */
describe('deriveFkGraph — module roots', () => {
  it('refuses a root that does not resolve, rather than reading an empty listing', () => {
    // Issue #215's shape. `src/db/migrations` and the rest of the residue are
    // still here; only the module tree has moved. Before T013 this produced a
    // graph with no owner, no edge and no finding — a clean report over a tree
    // the scan never found.
    mkdirSync(join(root, 'db', 'migrations'), { recursive: true });

    expect(() => deriveFkGraph(root)).toThrow(FkGraphRootError);
    expect(() => deriveFkGraph(root)).toThrow(/do not resolve/);
  });

  it('names the root it could not resolve', () => {
    mkdirSync(join(root, 'db', 'migrations'), { recursive: true });
    const packages: ModuleRoot = { directory: join(root, 'packages'), origin: 'external' };

    // The core root is there, the package one is not: a partial configuration
    // has to fail on the member that is missing and name it.
    entities('orders', 'orders');
    expect(() => deriveFkGraph(root, { moduleRoots: [coreModuleRoot(root), packages] })).toThrow(
      /packages/,
    );
  });

  it('accepts a root that resolves and holds no module — that is a population', () => {
    // The discrimination. "No module here" is an answer; "no directory here" is
    // a broken scan, and collapsing the two is what the refusal above is for.
    mkdirSync(join(root, 'modules'), { recursive: true });

    const graph = deriveFkGraph(root);

    expect(graph.modules.size).toBe(0);
    expect(graph.edges).toEqual([]);
  });

  it('reads a module under a package root and tags it, files and all', () => {
    entities('catalog', 'products');
    mkdirSync(join(root, 'packages'), { recursive: true });
    const dir = join(root, 'packages', 'loyalty', 'entities');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'points.entity.ts'),
      `import { Entity } from '@mikro-orm/core';\n` +
        `@Entity({ tableName: 'loyalty_points' })\n` +
        `export class Some {}\n`,
      'utf8',
    );

    const graph = deriveFkGraph(root, {
      moduleRoots: [coreModuleRoot(root), { directory: join(root, 'packages'), origin: 'external' }],
    });

    expect(graph.modules.get('loyalty')?.origin).toBe('external');
    expect(graph.modules.get('loyalty')?.files).toBe(1);
    expect(graph.modules.get('catalog')?.origin).toBe('core');
    expect(graph.owners.get('loyalty_points')).toBe('loyalty');
  });

  it('refuses one module id claimed by two roots', () => {
    // Last-wins would move the module's origin — and with it its baseline
    // membership — with nothing saying so.
    entities('catalog', 'products');
    const shadow = join(root, 'packages', 'catalog', 'entities');
    mkdirSync(shadow, { recursive: true });
    writeFileSync(join(shadow, 'x.entity.ts'), `@Entity({ tableName: 'x' })\n`, 'utf8');

    expect(() =>
      deriveFkGraph(root, {
        moduleRoots: [
          coreModuleRoot(root),
          { directory: join(root, 'packages'), origin: 'external' },
        ],
      }),
    ).toThrow(/claimed by two roots/);
  });

  it('tags a migration with the origin of the root its module was found under', () => {
    entities('catalog', 'products');
    migration('catalog', '20260901T090000_catalog_init', `create table "products" ("id" uuid);`);
    const dir = join(root, 'packages', 'loyalty', 'migrations');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '20260501T090000_loyalty_init.ts'),
      `import { Migration } from '@mikro-orm/migrations';\n` +
        `export class X extends Migration {\n` +
        `  override async up(): Promise<void> {\n` +
        `    this.addSql(\`create table "loyalty_points" ("id" uuid not null);\`);\n` +
        `  }\n` +
        `}\n`,
      'utf8',
    );

    const graph = deriveFkGraph(root, {
      moduleRoots: [coreModuleRoot(root), { directory: join(root, 'packages'), origin: 'external' }],
    });

    expect(graph.tableCreators.get('products')?.origin).toBe('core');
    expect(graph.tableCreators.get('loyalty_points')?.origin).toBe('external');
    // The stamp is inside the frozen window and the origin is not: the two
    // together are the rule the published baseline list is generated from
    // (`instance-migration-order.md` R1.3 — the committed sources at or below
    // the watermark), and only the pair can tell this file from a core one
    // (D-154). `migration-order.ts` itself no longer asks either question: it
    // enters the prefix by identity, against that list.
    expect(graph.tableCreators.get('loyalty_points')?.timestamp).toBe('20260501T090000');
  });
});

describe('deriveFkGraph — core migrations', () => {
  it('scans src/db/migrations/ too and never attributes ownership to core', () => {
    entities('catalog', 'products');
    entities('organizations', 'organizations');
    const dir = join(root, 'db', 'migrations');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '20260901T090000_core_foundation_init.ts'),
      `import { Migration } from '@mikro-orm/migrations';\n` +
        `export class X extends Migration {\n` +
        `  override async up(): Promise<void> {\n` +
        `    this.addSql(\`create table "products" ("id" uuid not null, "organization_id" uuid references "organizations" ("id"));\`);\n` +
        `  }\n` +
        `}\n`,
      'utf8',
    );

    const graph = deriveFkGraph(root);

    // `products` is created by a core migration but owned by catalog's entity.
    expect(graph.owners.get('products')).toBe('catalog');
    expect(edgeKeys(graph)).toEqual(['catalog→organizations']);
    expect([...graph.owners.values()]).not.toContain('core');
  });
});
