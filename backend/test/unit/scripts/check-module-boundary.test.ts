import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  CANONICAL_SHARD_ENTRY_TYPE,
  checkModuleBoundary,
  collectModuleFiles,
  collectSchemaFiles,
  declaredEntryType,
  findCrossModuleSql,
  generatedExemptionIssues,
  isPermanent,
  keyOf,
  ledgerDirectory,
  loadLedgerShards,
  permanentEntryIssue,
  reasonOf,
  recordedSites,
  shardShapeIssue,
  sourcesOf,
  vacuousReason,
  type LedgerEntry,
  type LedgerShard,
} from '../../../scripts/check-module-boundary.js';
import { resolveModuleLayout } from '../../../scripts/lib/module-roots.js';

/**
 * The module-boundary rule's own test (feature 075, FR-001…FR-005, FR-020…FR-028).
 *
 * `check-module-boundary` is the ratchet under a 674-site sweep, so what it must
 * prove is not that it agrees with today's tree — it agrees with today's tree by
 * construction, because today's tree is fully ledgered — but that it goes **red**
 * on each specifier shape, on both nesting depths, and on each of the five ways
 * a ledger can lie.
 *
 * Sources are synthetic and keyed by their path under `src/`, because that path
 * is what decides the owning module, the target module and whether the file is
 * scanned at all. The tests that read the real tree derive their root from
 * `import.meta.url`: an absolute path baked into a test passes on the machine it
 * was written on and fails in CI.
 */

const ORDER_SERVICE = 'modules/orders/services/order-service.ts';
const PRODUCT = 'catalog/entities/product.entity';

function tree(source: string, file: string = ORDER_SERVICE): Map<string, string> {
  return new Map([
    ['modules/orders/backend.ts', 'export function registerModule(ctx) {}'],
    ['modules/catalog/backend.ts', 'export function registerModule(ctx) {}'],
    [file, source],
  ]);
}

function shard(moduleId: string, entries: Record<string, LedgerEntry>): LedgerShard {
  return { moduleId, entries };
}

describe('analyzeSource — the specifier shapes it has to see', () => {
  it('sees a value import of another module', () => {
    const found = analyzeSource(
      "import { Product } from '../../catalog/entities/product.entity.js';",
      ORDER_SERVICE,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      moduleId: 'orders',
      target: 'catalog',
      targetPath: 'entities/product.entity',
      kind: 'value-import',
      surface: 'entity',
      overlay: false,
      line: 1,
    });
  });

  it('sees a type-only import — FR-003, on the same terms as a value import', () => {
    const found = analyzeSource(
      "import type { CartService } from '../../carts/services/cart-service.js';",
      ORDER_SERVICE,
    );
    expect(found.map((f) => f.kind)).toEqual(['type-only-import']);
    expect(found[0]?.surface).toBe('service');
  });

  it('reads `import { type A, B }` as its own kind, not as a type-only import', () => {
    // A classifier that reads the first specifier and stops calls this
    // type-only; one that requires every specifier to be typed calls it a value
    // import. Both are violations, and the kind records which reading was taken.
    const found = analyzeSource(
      "import { type ProductId, Product } from '../../catalog/entities/product.entity.js';",
      ORDER_SERVICE,
    );
    expect(found.map((f) => f.kind)).toEqual(['mixed-type-specifier']);
  });

  it('sees a re-export', () => {
    const found = analyzeSource(
      "export { Product } from '../../catalog/entities/product.entity.js';",
      ORDER_SERVICE,
    );
    expect(found.map((f) => f.kind)).toEqual(['re-export']);
  });

  it('sees a bare side-effect import', () => {
    const found = analyzeSource("import '../../catalog/register.js';", ORDER_SERVICE);
    expect(found.map((f) => f.kind)).toEqual(['side-effect-import']);
  });

  it('sees a dynamic import inside a method body', () => {
    // Two of the tree's 674 are exactly this: invisible to a reviewer scanning
    // the import block, and to a bundler.
    const found = analyzeSource(
      'async reserve() { const m = await import("../../inventory/services/reservation.js"); }',
      ORDER_SERVICE,
    );
    expect(found.map((f) => f.kind)).toEqual(['dynamic-import']);
    expect(found[0]?.target).toBe('inventory');
  });

  it('sees a require call', () => {
    const found = analyzeSource(
      "const { Product } = require('../../catalog/entities/product.entity.js');",
      ORDER_SERVICE,
    );
    expect(found.map((f) => f.kind)).toEqual(['require-call']);
  });

  it('sees an inline `import("…").Type` annotation', () => {
    const found = analyzeSource(
      "let p: import('../../catalog/entities/product.entity.js').Product;",
      ORDER_SERVICE,
    );
    expect(found.map((f) => f.kind)).toEqual(['import-type-node']);
  });

  it('does not read a specifier out of a comment or a string literal', () => {
    const found = analyzeSource(
      [
        "// import { Product } from '../../catalog/entities/product.entity.js';",
        "const path = '../../catalog/entities/product.entity.js';",
      ].join('\n'),
      ORDER_SERVICE,
    );
    expect(found).toEqual([]);
  });
});

describe('analyzeSource — resolution, at both nesting depths', () => {
  // The documented 2.2× undercount came from a prefix match that saw one
  // nesting depth. The specifier is normalised against the importing file's
  // directory before the target module is decided, so both depths land on the
  // same target and produce the same ledger key.
  it('resolves a sibling-depth specifier from a module root file', () => {
    const found = analyzeSource(
      "import { Product } from '../catalog/entities/product.entity.js';",
      'modules/blog/plugin.ts',
    );
    expect(found.map((f) => f.target)).toEqual(['catalog']);
  });

  it('resolves a nested-depth specifier from a service file', () => {
    const found = analyzeSource(
      "import { Product } from '../../catalog/entities/product.entity.js';",
      'modules/blog/services/blog-service.ts',
    );
    expect(found.map((f) => f.target)).toEqual(['catalog']);
  });

  it('gives both depths the same target path, so one key describes one edge', () => {
    const sibling = analyzeSource(
      "import { Product } from '../catalog/entities/product.entity.js';",
      'modules/blog/plugin.ts',
    );
    const nested = analyzeSource(
      "import { Product } from '../../catalog/entities/product.entity.js';",
      'modules/blog/services/blog-service.ts',
    );
    expect(sibling[0]?.targetPath).toBe(nested[0]?.targetPath);
    expect(sibling[0]?.targetPath).toBe('entities/product.entity');
  });

  it('applies the rule to overlay modules too — they are lifecycle participants', () => {
    const found = analyzeSource(
      "import { Loyalty } from '../../loyalty/services/loyalty-service.js';",
      'apps/example/modules/rewards/services/rewards-service.ts',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ moduleId: 'rewards', target: 'loyalty', overlay: true });
  });

  it('lets an overlay module reach the core module of the same name — different directories', () => {
    // The identity of a module here is its directory, not its name: an overlay
    // `catalog` reaching core `catalog` is a cross-tree edge, and a rule keyed
    // on the bare id would call it internal.
    const found = analyzeSource(
      "import { Product } from '../../../../../modules/catalog/entities/product.entity.js';",
      'apps/example/modules/catalog/services/x.ts',
    );
    expect(found.map((f) => f.target)).toEqual(['catalog']);
  });
});

describe('analyzeSource — what it must not flag', () => {
  it('ignores a specifier resolving inside the importing module', () => {
    expect(
      analyzeSource("import { Order } from '../entities/order.entity.js';", ORDER_SERVICE),
    ).toEqual([]);
  });

  it('ignores the platform roots and the shared infrastructure', () => {
    for (const root of ['kernel', 'http', 'events', 'tenancy', 'commands', 'db', 'overlay']) {
      expect(
        analyzeSource(`import { X } from '../../../${root}/index.js';`, ORDER_SERVICE),
        root,
      ).toEqual([]);
    }
  });

  it('ignores bare package specifiers', () => {
    const source = [
      "import { z } from 'zod';",
      "import { orderSchema } from '@endora-commerce/contracts';",
      "import { EntityManager } from '@mikro-orm/postgresql';",
    ].join('\n');
    expect(analyzeSource(source, ORDER_SERVICE)).toEqual([]);
  });

  it('ignores a file that belongs to no module', () => {
    expect(
      analyzeSource(
        "import { Product } from './modules/catalog/entities/product.entity.js';",
        'composition.ts',
      ),
    ).toEqual([]);
  });

  it('ignores a generated file a named generator owns', () => {
    // Not a `.generated.` filename match: a file is exempt because a generator
    // owns it, and `GENERATED_MODULE_FILES` says which.
    expect(
      analyzeSource(
        "import { manifest } from '../catalog/manifest.js';",
        'modules/_lifecycle/manifest-index.generated.ts',
      ),
    ).toEqual([]);
  });
});

/**
 * The schema every SQL fixture below resolves against — source text, never a
 * ready-made table→owner map.
 *
 * Handing the analysis a map would leave both owner-map passes unproven, and the
 * migration pass is the one that matters: an entity-only map is blind to every
 * join table and every channel bridge (D-87, F2). So the fixture declares
 * `products`, `blog_posts` and `cms_blocks` through `@Entity({ tableName })`,
 * `assets` through a class name the naming strategy pluralises, `sales_channels`
 * through a **kernel** entity, and `sales_channel_products` through `create
 * table` DDL in the pre-065 core block and nothing else.
 */
const SQL_SCHEMA: ReadonlyMap<string, string> = new Map([
  [
    'modules/catalog/entities/product.entity.ts',
    "@Entity({ tableName: 'products' })\nexport class Product {}",
  ],
  [
    'modules/blog/entities/blog-post.entity.ts',
    "@Entity({ tableName: 'blog_posts' })\nexport class BlogPost {}",
  ],
  // No `tableName`: the owner map has to run the naming strategy to get `assets`.
  ['modules/assets_library/entities/asset.entity.ts', '@Entity()\nexport class Asset {}'],
  [
    'modules/cms/entities/cms-block.entity.ts',
    "@Entity({ tableName: 'cms_blocks' })\nexport class CmsBlock {}",
  ],
  [
    'kernel/sales-channels/sales-channel.entity.ts',
    "@Entity({ tableName: 'sales_channels' })\nexport class SalesChannel {}",
  ],
  [
    'db/migrations/20260424T165847_core_foundation_init.ts',
    'this.addSql(`create table "sales_channel_products" ' +
      '("sales_channel_id" uuid not null, "product_id" uuid not null);`);',
  ],
]);

/** One module source against the fixture schema — source text in, findings out. */
function sqlFindings(source: string, file: string) {
  return findCrossModuleSql({
    sources: new Map([[file, source]]),
    schema: new Map([...SQL_SCHEMA, [file, source]]),
  }).found;
}

describe('the sql predicate — the shapes it has to see (D-87)', () => {
  const BLOG_SERVICE = 'modules/blog/services/blog-service.ts';

  it('sees a select against another module’s table', () => {
    const found = sqlFindings(
      'const rows = await conn.execute(`select id from products where status = ?`, [s]);',
      BLOG_SERVICE,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      predicate: 'sql',
      moduleId: 'blog',
      target: 'catalog',
      table: 'products',
      direction: 'read',
    });
  });

  it('sees the joined table, not the module’s own one', () => {
    const found = sqlFindings(
      'await conn.execute(`select p.id, a.url from blog_posts p join assets a on a.id = p.cover_id`);',
      BLOG_SERVICE,
    );
    expect(found.map((f) => f.table)).toEqual(['assets']);
    expect(found[0]?.target).toBe('assets_library');
  });

  it('records a write as a write', () => {
    // The direction selects the remedy: a bridge read has a port, a bridge write
    // also has an audit row nobody is recording.
    const found = sqlFindings(
      'await conn.execute(`insert into "cms_blocks" ("id", "slug") values (?, ?)`, [id, slug]);',
      'modules/newsletter/services/consent-block-seeder.ts',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ target: 'cms', table: 'cms_blocks', direction: 'write' });
  });

  it('sees a bridge table whose only declaration is `create table` DDL', () => {
    // The shape an entity-only owner map reports zero of, and the cluster the
    // live defect sits in: `sales_channel_products` is declared by no entity
    // class anywhere in the tree.
    const found = sqlFindings(
      'await conn.execute(`select product_id from sales_channel_products where sales_channel_id = ?`, [id]);',
      'modules/catalog/services/catalog-query.service.ts',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ moduleId: 'catalog', target: 'kernel', table: 'sales_channel_products' });
  });

  it('reads a template literal whose `in (…)` list is built by a substitution', () => {
    const found = sqlFindings(
      'await conn.execute(`select id from products where id in (${ids.map(() => \'?\').join(\',\')})`, ids);',
      BLOG_SERVICE,
    );
    expect(found.map((f) => f.table)).toEqual(['products']);
  });

  it('names the module’s own table as the module’s own', () => {
    expect(sqlFindings('await conn.execute(`select * from blog_posts`);', BLOG_SERVICE)).toEqual([]);
  });

  it('does not read SQL out of a comment', () => {
    // The regex-over-source spike hallucinated a dozen tables — `every`,
    // `bumps`, `used`, `path` — because an apostrophe in English prose opens a
    // string literal that runs to the next apostrophe. Reading literal *nodes*
    // takes comments out of the population by construction.
    const source = [
      '/* Historically this did `select id from products`, which is why the port exists. */',
      "// It's the same read, and it's the one that couldn't stay: select id from products.",
      'export class BlogService {}',
    ].join('\n');
    expect(sqlFindings(source, BLOG_SERVICE)).toEqual([]);
  });

  it('ignores a migration — the execution order owns that question', () => {
    expect(
      sqlFindings(
        'this.addSql(`select id from products`);',
        'modules/blog/migrations/20260810T101010_blog_thing.ts',
      ),
    ).toEqual([]);
  });

  it('ignores a table nobody owns, and does not throw doing it', () => {
    expect(sqlFindings('await conn.execute(`select 1 from a_table_nobody_owns`);', BLOG_SERVICE)).toEqual(
      [],
    );
  });

  it('does not read English prose as an UPDATE', () => {
    // `'Update products in the catalog'` is an UPDATE against `catalog`'s
    // `products` table to a test that only anchors on the first word.
    expect(
      sqlFindings("const label = 'Update products in the catalog';", BLOG_SERVICE),
    ).toEqual([]);
  });

  it('does not treat a CTE name that shadows a table as that table', () => {
    const found = sqlFindings(
      'await conn.execute(`with products as (select id from blog_posts) select * from products`);',
      BLOG_SERVICE,
    );
    expect(found).toEqual([]);
  });
});

/**
 * The knex query builder — the `sql` predicate's third recognition path
 * (issue #187).
 *
 * A builder names its table as an **argument to a call**, not inside a statement
 * literal, so the statement path is blind to it and the import path is blind to
 * it too (a builder names no specifier). Seven cross-module accesses in five
 * files stood invisible to both while `sql=111` read as the whole coupling.
 *
 * Every fixture below enters as source text against the same fixture schema, so
 * the owner map's two passes run rather than being handed their answer, and each
 * positive asserts `syntax: 'builder'` — a proof that only checked the table
 * would go green off the statement path it is not testing.
 */
describe('the sql predicate — knex query builders (issue #187)', () => {
  const BLOG_SERVICE = 'modules/blog/services/blog-service.ts';
  /** The shape 34 of the tree's ~40 builder queries start with. */
  const BOUND_KNEX = 'const knex = em.getKnex();';

  it('sees a table named as the knex callable’s argument', () => {
    const found = sqlFindings(
      `${BOUND_KNEX}\nconst rows = await knex('products').where('status', s).select('id');`,
      BLOG_SERVICE,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      predicate: 'sql',
      syntax: 'builder',
      moduleId: 'blog',
      target: 'catalog',
      table: 'products',
      direction: 'read',
    });
  });

  it('sees a table named by `from`', () => {
    const found = sqlFindings(
      "const rows = await em.getKnex().from('products').where('status', s);",
      BLOG_SERVICE,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ syntax: 'builder', table: 'products', target: 'catalog' });
  });

  it('sees a table named by `join`, and reads the join condition as columns', () => {
    // `order-service.ts:1199` in full: the joined table is the finding, and the
    // two column arguments that follow it are not tables however they are
    // spelled.
    const found = sqlFindings(
      `${BOUND_KNEX}\n` +
        "const rows = await knex('blog_posts as b')\n" +
        "  .join('assets as a', 'a.id', 'b.cover_id')\n" +
        "  .select('a.url');",
      BLOG_SERVICE,
    );
    expect(found.map((f) => f.table)).toEqual(['assets']);
    expect(found[0]).toMatchObject({ syntax: 'builder', target: 'assets_library' });
  });

  it('sees each join variant, not only the one the tree happens to call today', () => {
    for (const method of [
      'innerJoin',
      'leftJoin',
      'leftOuterJoin',
      'rightJoin',
      'rightOuterJoin',
      'fullOuterJoin',
      'crossJoin',
    ]) {
      const found = sqlFindings(
        `${BOUND_KNEX}\nawait knex('blog_posts').${method}('products', 'products.id', 'blog_posts.product_id');`,
        BLOG_SERVICE,
      );
      expect(found.map((f) => f.table), method).toEqual(['products']);
    }
  });

  it('sees a table named by `into` and by `table`', () => {
    for (const method of ['into', 'table']) {
      const found = sqlFindings(
        `${BOUND_KNEX}\nawait knex.insert(rows).${method}('cms_blocks');`,
        BLOG_SERVICE,
      );
      expect(found.map((f) => f.table), method).toEqual(['cms_blocks']);
    }
  });

  it('strips an alias and a schema qualifier from the table it reads', () => {
    const found = sqlFindings(
      `${BOUND_KNEX}\nawait knex('public.products as p').where('p.status', s);`,
      BLOG_SERVICE,
    );
    expect(found.map((f) => f.table)).toEqual(['products']);
  });

  it('reads the aliasing object form `knex({ p: "products" })`', () => {
    // `stock-level-service.ts:190` — the alias is the key and the table is the
    // value, so a first-argument-must-be-a-string rule reports nothing here.
    const found = sqlFindings(
      `${BOUND_KNEX}\nconst q = knex({ p: 'products' }).where('p.status', s);`,
      BLOG_SERVICE,
    );
    expect(found.map((f) => f.table)).toEqual(['products']);
  });

  it('sees a bridge table whose only declaration is `create table` DDL', () => {
    const found = sqlFindings(
      `${BOUND_KNEX}\nawait knex('sales_channel_products').where('sales_channel_id', id);`,
      'modules/catalog/services/catalog-query.service.ts',
    );
    expect(found[0]).toMatchObject({
      syntax: 'builder',
      table: 'sales_channel_products',
      target: 'kernel',
    });
  });

  it('records a builder write as a write', () => {
    const found = sqlFindings(
      `${BOUND_KNEX}\nawait knex('cms_blocks').insert({ id, slug });`,
      'modules/newsletter/services/consent-block-seeder.ts',
    );
    expect(found[0]).toMatchObject({ syntax: 'builder', table: 'cms_blocks', direction: 'write' });
  });

  it('records an update through a builder as a write', () => {
    const found = sqlFindings(
      `${BOUND_KNEX}\nawait knex('cms_blocks').where('id', id).update({ slug });`,
      'modules/newsletter/services/consent-block-seeder.ts',
    );
    expect(found[0]).toMatchObject({ direction: 'write' });
  });

  it('names the module’s own table as the module’s own', () => {
    expect(
      sqlFindings(`${BOUND_KNEX}\nawait knex('blog_posts').select('id');`, BLOG_SERVICE),
    ).toEqual([]);
  });

  it('does not read a column argument as a table, however it is spelled', () => {
    // The reason the method list is enumerated rather than "any string literal
    // on any builder method": `where`, `select` and `orderBy` take columns, and
    // a column spelled like another module's table is not a reach into it. The
    // control is in the same fixture, so this cannot pass by seeing nothing.
    const found = sqlFindings(
      `${BOUND_KNEX}\n` +
        "await knex('products').where('status', s);\n" +
        "await knex('blog_posts').select('cms_blocks').where('assets', true).orderBy('products');",
      BLOG_SERVICE,
    );
    expect(found.map((f) => f.table)).toEqual(['products']);
    expect(found[0]).toMatchObject({ syntax: 'builder' });
  });

  it('does not read a table-shaped literal on a call that is not a builder', () => {
    // The flooding shape, measured: `isPresent('inventory')`,
    // `defineModuleManifest('catalog')` and `@Entity({ tableName: 'products' })`
    // put a table-shaped literal in 270 argument positions the builder never
    // reaches. The control is in the same fixture.
    const found = sqlFindings(
      `${BOUND_KNEX}\n` +
        "await knex('products').where('status', s);\n" +
        "if (!effectiveState.isPresent('assets')) return;\n" +
        "this.log('cms_blocks', 'seeded');",
      BLOG_SERVICE,
    );
    expect(found.map((f) => f.table)).toEqual(['products']);
  });

  it('does not read a builder call on an identifier no `getKnex()` bound', () => {
    // The knex callable has no method name to key on, so the callee has to be
    // known to hold a knex instance. Nothing else may open the door: a bare
    // `translate('products')` is not a query.
    const found = sqlFindings(
      `${BOUND_KNEX}\nawait knex('products').select('id');\nconst label = translate('assets');`,
      BLOG_SERVICE,
    );
    expect(found.map((f) => f.table)).toEqual(['products']);
  });

  it('ignores a builder in a migration — the execution order owns that question', () => {
    expect(
      sqlFindings(
        `${BOUND_KNEX}\nawait knex('products').select('id');`,
        'modules/blog/migrations/20260810T101010_blog_thing.ts',
      ),
    ).toEqual([]);
  });

  it('ignores a builder over a table nobody owns', () => {
    expect(
      sqlFindings(`${BOUND_KNEX}\nawait knex('a_table_nobody_owns').select('id');`, BLOG_SERVICE),
    ).toEqual([]);
  });

  it('gives a statement and a builder over one table in one file a single key', () => {
    // The ledger key is `<file>:sql:<owner>/<table>` for both paths, so the two
    // syntaxes over one table are one entry that retires when the last of them
    // goes — the same property FR-026 gives the import predicate.
    const found = sqlFindings(
      `${BOUND_KNEX}\n` +
        "await knex('products').select('id');\n" +
        'await conn.execute(`select id from products`);',
      BLOG_SERVICE,
    );
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.syntax).sort()).toEqual(['builder', 'statement']);
    expect(new Set(found.map(keyOf)).size).toBe(1);
  });
});

describe('the table→owner map — two sources, and the entity wins', () => {
  it('resolves a table from an entity’s `tableName`', () => {
    const found = sqlFindings(
      'await conn.execute(`select id from products`);',
      'modules/blog/services/blog-service.ts',
    );
    expect(found[0]?.target).toBe('catalog');
  });

  it('resolves a table from the naming strategy when the entity sets no `tableName`', () => {
    const found = sqlFindings(
      'await conn.execute(`select id from assets`);',
      'modules/blog/services/blog-service.ts',
    );
    expect(found[0]?.target).toBe('assets_library');
  });

  it('attributes a core-block join table to the module that owns its leading table', () => {
    // `sales_channel_products` is declared in `src/db/migrations`, which is no
    // module. The judgement is derived from the map rather than listed in it:
    // the table its name begins with is `sales_channels`, and the kernel owns
    // that.
    const found = sqlFindings(
      'await conn.execute(`select product_id from sales_channel_products`);',
      'modules/search/services/search-indexer.ts',
    );
    expect(found[0]?.target).toBe('kernel');
  });

  it('counts both passes separately, so a blind one cannot hide behind the other', () => {
    const { report } = findCrossModuleSql({ sources: new Map(), schema: SQL_SCHEMA });
    expect(report.entityTables).toBe(5);
    expect(report.migrationTables).toBe(1);
    expect(report.migrationOnlyTables).toBe(1);
    expect(report.unattributed).toEqual([]);
  });
});

// Six of the eight. The count (issue #267) has its own block below, because its
// fixtures need a file that reaches its target more than once; the eighth — a
// shard declaring an entry type of its own (issue #217) — needs a file rather
// than a record, so it has its own block at the end of this file.
describe('checkModuleBoundary — the six ways the ledger fails', () => {
  const CROSS = "import { Product } from '../../catalog/entities/product.entity.js';";
  const key = `${ORDER_SERVICE}:${PRODUCT}`;

  it('fails on an unledgered import', () => {
    const result = checkModuleBoundary({ sources: tree(CROSS) }, []);
    expect(result.violations.map(keyOf)).toEqual([key]);
    expect(result.total).toBe(1);
  });

  it('passes when the edge is ledgered in its own module shard', () => {
    const result = checkModuleBoundary({ sources: tree(CROSS) }, [
      shard('orders', { [key]: 'F3 Phase C — orders.' }),
    ]);
    expect(result.violations).toEqual([]);
    expect(result.ledgered.map(keyOf)).toEqual([key]);
    expect(result.stale).toEqual([]);
  });

  it('fails on a stale entry — the edge it describes is gone', () => {
    const clean = 'export class OrderService {}';
    const result = checkModuleBoundary({ sources: tree(clean) }, [
      shard('orders', { [key]: 'F3 Phase C — orders.' }),
    ]);
    expect(result.violations).toEqual([]);
    expect(result.stale).toEqual([key]);
  });

  it('fails on an empty shard — delete the file instead', () => {
    const clean = 'export class OrderService {}';
    const result = checkModuleBoundary({ sources: tree(clean) }, [shard('orders', {})]);
    expect(result.emptyShards).toEqual(['orders']);
  });

  it('fails on an orphan shard — a shard for a module that does not exist', () => {
    const result = checkModuleBoundary({ sources: tree(CROSS) }, [
      shard('orders', { [key]: 'F3 Phase C — orders.' }),
      shard('there_is_no_such_module', { 'modules/there_is_no_such_module/x.ts:catalog/y': 'why' }),
    ]);
    expect(result.orphanShards).toEqual(['there_is_no_such_module']);
  });

  it('fails on a misfiled entry — one shard cannot absorb another module’s violation', () => {
    // Without this, an engineer blocked on `catalog` could park an `orders`
    // finding in `catalog.ts` and both merge requests would read green.
    const result = checkModuleBoundary({ sources: tree(CROSS) }, [
      shard('catalog', { [key]: 'parked here so orders reads clean' }),
    ]);
    expect(result.misfiledEntries).toEqual([`catalog: ${key}`]);
    expect(result.violations.map(keyOf)).toEqual([key]);
  });

  it('fails on a key that does not parse as `<file>:<target>/<path>`', () => {
    const result = checkModuleBoundary({ sources: tree(CROSS) }, [
      shard('orders', { 'modules/orders/services/order-service.ts': 'no target half' }),
    ]);
    expect(result.misfiledEntries).toEqual([
      'orders: modules/orders/services/order-service.ts',
    ]);
  });

  // --- permanent entries (D-77) --------------------------------------------
  //
  // The flag says "this edge is not debt": it rests on something in the tree,
  // and no cut merge request will remove it. Both halves of that claim are
  // checked — it leaves `ledger-size`, and it has to name what would retire it,
  // because an entry nobody can argue with later is exactly what the flag must
  // not be allowed to create.

  const PERMANENT = {
    permanent: true,
    reason:
      'The coupling is `fk_product_attributes_custom_field_definition`, `on delete restrict`: ' +
      'a child insert must see its parent inside one transaction.',
    retiredBy:
      'F4 gives `custom_fields` a package entry point that exports this seam, or the foreign key is dropped.',
  } as const;

  it('accepts a permanent entry and keeps it out of ledger-size', () => {
    const result = checkModuleBoundary({ sources: tree(CROSS) }, [
      shard('orders', { [key]: PERMANENT }),
    ]);
    expect(result.violations).toEqual([]);
    expect(result.ledgered.map(keyOf)).toEqual([key]);
    expect(result.permanentKeys).toEqual([key]);
    expect(result.permanentIssues).toEqual([]);
  });

  it('fails a permanent entry that names no retiring condition', () => {
    const result = checkModuleBoundary({ sources: tree(CROSS) }, [
      shard('orders', { [key]: { ...PERMANENT, retiredBy: '  ' } }),
    ]);
    expect(result.permanentIssues).toEqual([`${key} is permanent but names no retiring condition`]);
  });

  it('fails a permanent entry whose retiring condition is the sweep itself', () => {
    // "Retired by the cut merge request" is the reason every drainable entry
    // carries. An entry claiming both permanence and that exit is claiming
    // nothing, and it is the most likely way the flag gets misused.
    const result = checkModuleBoundary({ sources: tree(CROSS) }, [
      shard('orders', { [key]: { ...PERMANENT, retiredBy: 'The import_export cut merge request.' } }),
    ]);
    expect(result.permanentIssues).toHaveLength(1);
    expect(result.permanentIssues[0]).toContain('names the sweep as its retiring condition');
  });

  it('fails a permanent entry that states no reason', () => {
    const result = checkModuleBoundary({ sources: tree(CROSS) }, [
      shard('orders', { [key]: { ...PERMANENT, reason: '' } }),
    ]);
    expect(result.permanentIssues).toEqual([`${key} is permanent but states no reason`]);
  });

  it('goes stale on a permanent entry exactly as on a draining one', () => {
    // Permanence is a claim about *why* the edge stands, not a licence to
    // describe an import that is gone.
    const clean = 'export class OrderService {}';
    const result = checkModuleBoundary({ sources: tree(clean) }, [
      shard('orders', { [key]: PERMANENT }),
    ]);
    expect(result.stale).toEqual([key]);
  });

  it('refuses a shard value that is neither a reason nor a permanent entry', () => {
    // A shard is loaded through a dynamic import, so `tsc` never sees it: a
    // typo in the flag would otherwise be read as an object with no reason and
    // silently accepted as debt.
    const result = checkModuleBoundary({ sources: tree(CROSS) }, [
      shard('orders', { [key]: { permanently: true, reason: 'typo' } as never }),
    ]);
    expect(result.permanentIssues).toHaveLength(1);
    expect(result.permanentIssues[0]).toContain('neither a reason nor a permanent entry');
  });

  it('keys the edge by file and target, so moving the import inside the file keeps it', () => {
    const moved = ['', '', 'export class OrderService {}', CROSS].join('\n');
    const result = checkModuleBoundary({ sources: tree(moved) }, [
      shard('orders', { [key]: 'F3 Phase C — orders.' }),
    ]);
    expect(result.violations).toEqual([]);
    expect(result.ledgered[0]?.line).toBe(4);
  });
});

/**
 * The count on an entry (issue #267).
 *
 * The ledger key is `(file, target)`, which answers "is this file already known
 * to reach that target" and not "how much" — so the **Nth** reach of a shape a
 * file already carries lands against an unchanged ledger. MR !793 added two
 * `product_categories` statements to two files that each already had an entry
 * for that table: `sql` rose 52 -> 54, `stale` and `violations` stayed 0, and
 * nothing asked anybody why.
 *
 * So the fixtures here are **files that reach one target twice**, entering as
 * source text like every other proof in this file: a fixture handing the
 * comparison a ready-made count would prove the arithmetic and nothing above it
 * — the walk that produces the number is the part that has to be exercised.
 */
describe('checkModuleBoundary — the count on an entry (issue #267)', () => {
  const key = `${ORDER_SERVICE}:${PRODUCT}`;
  const REASON = 'F3 Phase C — orders reads the product entity directly.';

  /** One file, one target, two reaches: a type import and a dynamic one. */
  const TWICE = [
    "import type { Product } from '../../catalog/entities/product.entity.js';",
    'export class OrderService {',
    "  async load() { return import('../../catalog/entities/product.entity.js'); }",
    '}',
  ].join('\n');

  const ONCE = "import { Product } from '../../catalog/entities/product.entity.js';";

  it('reads an omitted count as one, so the 60 single-reach entries stay sentences', () => {
    const result = checkModuleBoundary({ sources: tree(ONCE) }, [shard('orders', { [key]: REASON })]);
    expect(result.countIssues).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  it('fails an entry recording fewer reaches than the walk found', () => {
    // The gap itself: the file grew a second reach and the entry did not move.
    const result = checkModuleBoundary({ sources: tree(TWICE) }, [
      shard('orders', { [key]: REASON }),
    ]);
    expect(result.violations).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.countIssues).toHaveLength(1);
    expect(result.countIssues[0]).toContain('records 1, the walk found 2 (+1)');
  });

  it('fails an entry recording more reaches than the walk found', () => {
    // The stale direction, one granularity down: a number left standing after
    // the reaches under it went. Every other ledger in this tree ratchets both
    // ways, and a count that only ever rose would licence exactly that.
    const result = checkModuleBoundary({ sources: tree(TWICE) }, [
      shard('orders', { [key]: { sites: 3, reason: REASON } }),
    ]);
    expect(result.countIssues).toHaveLength(1);
    expect(result.countIssues[0]).toContain('records 3, the walk found 2 (-1)');
  });

  it('passes when the recorded count is what the walk found', () => {
    const result = checkModuleBoundary({ sources: tree(TWICE) }, [
      shard('orders', { [key]: { sites: 2, reason: REASON } }),
    ]);
    expect(result.countIssues).toEqual([]);
    expect(result.violations).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.ledgered).toHaveLength(2);
  });

  it('refuses a count that is not a positive integer', () => {
    // A shard is loaded through a dynamic import, so `tsc` never sees it — the
    // same reason the permanence flag is checked structurally. A count that
    // cannot be compared with the walk is worse than none: it reads as a
    // recorded number and answers nothing.
    for (const sites of [0, -1, 1.5, 'two' as unknown as number]) {
      const result = checkModuleBoundary({ sources: tree(TWICE) }, [
        shard('orders', { [key]: { sites, reason: REASON } }),
      ]);
      expect(result.countIssues, `sites: ${String(sites)}`).toHaveLength(1);
      expect(result.countIssues[0]).toContain('a site count is a positive integer');
    }
  });

  it('leaves an entry that describes no reach at all to the stale rule', () => {
    // Reporting it twice would name one defect two ways, and the name it
    // already has is the one the shards' own headers use.
    const result = checkModuleBoundary({ sources: tree('export class OrderService {}') }, [
      shard('orders', { [key]: { sites: 2, reason: REASON } }),
    ]);
    expect(result.stale).toEqual([key]);
    expect(result.countIssues).toEqual([]);
  });

  it('holds a permanent entry to the count on the same terms', () => {
    // Permanence answers "why does this edge stand", never "why does it stand
    // twice": a co-transactional seam that grows a second statement is worth
    // the question a draining one's growth gets.
    const permanent = {
      permanent: true,
      reason: 'A foreign key makes the seam co-transactional.',
      retiredBy: 'F4 gives `catalog` a package entry point that exports this seam.',
    } as const;
    const grown = checkModuleBoundary({ sources: tree(TWICE) }, [
      shard('orders', { [key]: permanent }),
    ]);
    expect(grown.permanentIssues).toEqual([]);
    expect(grown.countIssues).toHaveLength(1);
    expect(grown.countIssues[0]).toContain('records 1, the walk found 2 (+1)');

    const recorded = checkModuleBoundary({ sources: tree(TWICE) }, [
      shard('orders', { [key]: { ...permanent, sites: 2 } }),
    ]);
    expect(recorded.countIssues).toEqual([]);
    expect(recorded.permanentKeys).toEqual([key]);
  });

  it('counts the two predicates under one key, as the key already merged them', () => {
    // A statement and a builder over one table in one file are one entry
    // (issue #187) — and therefore two sites, which is the number the entry has
    // to record.
    const source = [
      "await em.getConnection().execute(`select id from products where id = ?`, [id]);",
      "await em.getKnex()('products').where('id', id);",
    ].join('\n');
    const sources = new Map([
      ['modules/orders/backend.ts', 'export function registerModule(ctx) {}'],
      ['modules/catalog/entities/product.entity.ts', "@Entity({ tableName: 'products' })\nexport class Product {}"],
      ['modules/orders/services/order-service.ts', source],
      ['db/migrations/20260101T000000_core_init.ts', 'this.addSql(`create table "order_items" ()`);'],
    ]);
    const sqlKey = `${ORDER_SERVICE}:sql:catalog/products`;
    const result = checkModuleBoundary({ sources, schema: sources }, [
      shard('orders', { [sqlKey]: { sites: 2, reason: REASON } }),
    ]);
    expect(result.violations).toEqual([]);
    expect(result.countIssues).toEqual([]);
    expect(result.ledgered).toHaveLength(2);
  });
});

describe('checkModuleBoundary — refusing a vacuous pass (FR-021)', () => {
  const READ_SOMETHING = {
    moduleFiles: ['modules/orders/a.ts', 'modules/catalog/b.ts'],
    registeredModules: ['orders', 'catalog'],
    ledgerDirectoryExists: true,
    entityTables: 220,
    migrationTables: 241,
  };

  it('reports a reason when the module walk returned nothing', () => {
    expect(vacuousReason({ ...READ_SOMETHING, moduleFiles: [] })).toMatch(
      /no module sources under src\/ — refusing to report a vacuous pass/,
    );
  });

  it('reports a reason when the walk returned a residue of the module tree', () => {
    // Issue #215. `src/apps` is the walk's second root, so a moved module tree
    // leaves this check reading five overlay files — non-empty, and every shard
    // an orphan. The orphan red is what hid it: the ledger is *meant* to drain,
    // and the day it does this reports `violations=0` over a tree it never
    // opened.
    expect(
      vacuousReason({
        ...READ_SOMETHING,
        moduleFiles: ['apps/example/modules/example_overlay/backend.ts'],
        registeredModules: ['orders', 'catalog'],
      }),
    ).toMatch(/produced none for 2 of the 2 registered modules \(catalog, orders\)/);
  });

  it('reports a reason when the ledger directory is missing', () => {
    expect(vacuousReason({ ...READ_SOMETHING, ledgerDirectoryExists: false })).toMatch(
      /ledger directory missing — refusing to report a vacuous pass/,
    );
  });

  it('reports a reason when the entity pass resolved no table', () => {
    expect(vacuousReason({ ...READ_SOMETHING, entityTables: 0 })).toMatch(
      /resolved no @Entity\(\) table/,
    );
  });

  it('reports a reason when the migration pass resolved no table', () => {
    // The pass that is *supposed* to be empty on a tree with no join tables is
    // exactly the pass whose silence means "entity-only, and blind to every
    // channel bridge". Each pass proves it looked, separately (issue #113).
    expect(vacuousReason({ ...READ_SOMETHING, migrationTables: 0 })).toMatch(
      /resolved no `create table` DDL/,
    );
  });

  it('reports no reason when it read all four', () => {
    expect(vacuousReason(READ_SOMETHING)).toBeNull();
  });

  it('refuses to load a ledger directory that is not there', async () => {
    await expect(loadLedgerShards(join(ledgerDirectory(), 'no-such-directory'))).rejects.toThrow(
      /refusing to report a vacuous pass/,
    );
  });
});

describe('the generated-file exemption is checked both ways', () => {
  it('reports an entry naming a file that is not there', () => {
    expect(generatedExemptionIssues(() => false)).not.toEqual([]);
  });

  it('reports an entry whose named generator is not there', () => {
    expect(generatedExemptionIssues((path) => !path.includes('scripts/'))).not.toEqual([]);
  });

  it('is silent when both ends exist in the real tree', () => {
    expect(generatedExemptionIssues()).toEqual([]);
  });
});

describe('the tree itself', () => {
  it('has every cross-module reach ledgered, in its own shard', async () => {
    const layout = await resolveModuleLayout();
    const shards = await loadLedgerShards(ledgerDirectory());
    const sources = sourcesOf(collectModuleFiles(layout.moduleWalkRoots), layout.keyOf);
    const schema = sourcesOf(collectSchemaFiles(layout.sourceRoots), layout.keyOf);
    expect(sources.size, 'no module sources found — a vacuous pass').toBeGreaterThan(1000);
    expect(schema.size, 'no schema sources found — a vacuous pass').toBeGreaterThan(sources.size);

    const result = checkModuleBoundary({ sources, schema }, shards);
    expect(result.tableOwners.entityTables, 'entity pass resolved nothing').toBeGreaterThan(100);
    expect(result.tableOwners.migrationOnlyTables, 'migration pass added nothing').toBeGreaterThan(
      0,
    );
    expect(result.violations.map(keyOf)).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.emptyShards).toEqual([]);
    expect(result.orphanShards).toEqual([]);
    expect(result.misfiledEntries).toEqual([]);
    expect(result.permanentIssues).toEqual([]);
    expect(result.countIssues).toEqual([]);
    expect(result.shardShapeIssues).toEqual([]);
  });

  it('scans the same files the CLI scans, and the walk is the shared one', async () => {
    // Both callers agree on the scan scope by construction rather than by two
    // similar walks — `check-container-imports.ts`' precedent. Since feature
    // 080's T040a the roots are resolved rather than spelled, so the count is
    // taken over the roots the layout answered with and a module that has left
    // `src/modules` is in both halves or in neither.
    const layout = await resolveModuleLayout();
    const files = collectModuleFiles(layout.moduleWalkRoots);
    expect(layout.moduleWalkRoots.length).toBeGreaterThan(0);
    expect(files.length).toBe(
      layout.moduleWalkRoots.reduce((total, root) => total + countTypeScriptFiles(root), 0),
    );
  });
});

function countTypeScriptFiles(dir: string): number {
  let total = 0;
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(full);
      } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
        total += 1;
      }
    }
  };
  walk(dir);
  return total;
}

describe('the ledger shards on disk', () => {
  it('names a reason and the question that retires it, in every entry', async () => {
    const shards = await loadLedgerShards(ledgerDirectory());
    expect(shards.length).toBeGreaterThan(0);
    for (const loaded of shards) {
      for (const [key, entry] of Object.entries(loaded.entries)) {
        const where = `${loaded.moduleId}: ${key}`;
        if (isPermanent(entry)) {
          // A permanent entry is held to the opposite rule from a draining one
          // (D-77): it is not waiting for a merge request, so it has to name
          // what *would* retire it, and the sweep is not an answer.
          expect(permanentEntryIssue(key, entry), where).toBeNull();
        }
        // Whichever of the three forms it takes, an entry carries a sentence
        // and a count that can be compared with the walk (issue #267).
        expect(reasonOf(entry).length, where).toBeGreaterThan(20);
        expect(recordedSites(entry), where).not.toBeNull();
      }
    }
  });

  it('records a count only where the file reaches its target more than once', async () => {
    // The field is omittable, and the reason it may be is measured: 60 of the
    // 68 keys standing when it landed cover exactly one reach. An entry
    // spelling `sites: 1` says what omitting it says, so the two spellings
    // would drift apart on their own.
    const shards = await loadLedgerShards(ledgerDirectory());
    const counted = shards.flatMap((loaded) =>
      Object.entries(loaded.entries)
        .filter(([, entry]) => typeof entry !== 'string' && entry.sites !== undefined)
        .map(([key, entry]) => [key, recordedSites(entry)] as const),
    );
    expect(counted.length).toBeGreaterThan(0);
    for (const [key, sites] of counted) expect(sites, key).toBeGreaterThan(1);
  });

  it('is a directory of module-named files and nothing else', async () => {
    const layout = await resolveModuleLayout();
    const names = readdirSync(ledgerDirectory());
    expect(names.filter((name) => !name.endsWith('.ts'))).toEqual([]);
    const modules = new Set(
      collectModuleFiles(layout.moduleWalkRoots).map((file) => layout.moduleIdOfPath(file)),
    );
    expect(names.map((name) => name.replace(/\.ts$/, '')).filter((id) => !modules.has(id))).toEqual(
      [],
    );
  });

  it('reads the same text the check reads', () => {
    // A shard is source the check imports; if it stops exporting `entries` the
    // load fails loudly rather than reporting an empty ledger.
    for (const name of readdirSync(ledgerDirectory())) {
      expect(readFileSync(join(ledgerDirectory(), name), 'utf8')).toContain('export const entries');
    }
  });
});

/**
 * The shape a shard declares (issue #217).
 *
 * `payments` was typed `Readonly<Record<string, string>>`, and so were 28 other
 * shards — only the four that had already had to hold a permanent entry declared
 * `Readonly<Record<string, LedgerEntry>>`, so there was no majority to learn the
 * shape from. Both consequences were silent: a permanent entry could not be
 * *written* in such a file, so the one edge `payments_order_fk` holds
 * co-transactional claimed permanence in prose and counted toward `ledger-size`
 * as debt nothing would drain, and `permanentEntryIssue` — the rule that refuses
 * a permanence claim naming no retiring condition — had no field to run on.
 *
 * So the proofs below enter where the shard does, through `loadLedgerShards`
 * over files written to disk: a shard handed in as a record is already past the
 * only place the declared type exists.
 */
describe('a shard declares one entry type, and its permanence rule runs over it', () => {
  const PAYMENTS_SEAM =
    'modules/payments/services/receive-payment-handler.ts:orders/entities/order.entity';
  const ORDERS_SEAM = 'modules/orders/services/order-service.ts:catalog/entities/product.entity';

  /** One crossing file, plus the module markers that make its owner exist. */
  const sources = (crossing: 'payments' | 'orders'): Map<string, string> =>
    new Map([
      ['modules/orders/backend.ts', 'export function registerModule(ctx) {}'],
      ['modules/catalog/backend.ts', 'export function registerModule(ctx) {}'],
      ['modules/payments/backend.ts', 'export function registerModule(ctx) {}'],
      crossing === 'payments'
        ? ([
            'modules/payments/services/receive-payment-handler.ts',
            "import { Order } from '../../orders/entities/order.entity.js';",
          ] as [string, string])
        : ([
            'modules/orders/services/order-service.ts',
            "import { Product } from '../../catalog/entities/product.entity.js';",
          ] as [string, string]),
    ]);

  /**
   * Writes real shard files and loads them through the check's own loader.
   *
   * The directory sits inside the test tree so a shard's `import type` resolves
   * the way every shard in `scripts/ledgers/` does — the fixture is a shard, not
   * a file shaped like one.
   */
  async function loadWritten(files: Record<string, string>): Promise<LedgerShard[]> {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const directory = mkdtempSync(join(here, 'ledger-shard-fixture-'));
    try {
      for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(directory, `${name}.ts`), body);
      }
      return await loadLedgerShards(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  const CANONICAL_SHARD = [
    "import type { LedgerEntry } from '../../../../scripts/check-module-boundary.js';",
    '',
    'export const entries: Readonly<Record<string, LedgerEntry>> = {',
    `  '${PAYMENTS_SEAM}': {`,
    '    permanent: true,',
    "    reason: '`payments_order_fk`, `on delete restrict`: the payment row and the order " +
      "status move in one transaction.',",
    "    retiredBy: '',",
    '  },',
    '};',
    '',
  ].join('\n');

  // The defect's own shape: the file `payments` shipped, with the seam its
  // string type forced into a sentence.
  const STRING_TYPED_SHARD = [
    'export const entries: Readonly<Record<string, string>> = {',
    `  '${PAYMENTS_SEAM}':`,
    "    'PERMANENT. `payments_order_fk` makes this co-transactional, so no cut retires it.',",
    '};',
    '',
  ].join('\n');

  it('runs the permanence rule over a shard loaded from disk', async () => {
    // The half that was unreachable while the file was string-typed: the entry
    // claims permanence, names no retiring condition, and is refused.
    const shards = await loadWritten({ payments: CANONICAL_SHARD });
    const result = checkModuleBoundary({ sources: sources('payments') }, shards);
    expect(result.shardShapeIssues).toEqual([]);
    expect(result.permanentKeys).toEqual([PAYMENTS_SEAM]);
    expect(result.permanentIssues).toEqual([
      `${PAYMENTS_SEAM} is permanent but names no retiring condition`,
    ]);
  });

  it('fails a shard typed `Readonly<Record<string, string>>`, as `payments` was', async () => {
    const shards = await loadWritten({ payments: STRING_TYPED_SHARD });
    const result = checkModuleBoundary({ sources: sources('payments') }, shards);
    expect(result.shardShapeIssues).toHaveLength(1);
    expect(result.shardShapeIssues[0]).toContain(
      'payments declares `Readonly<Record<string, string>>`',
    );
    // And what that typing cost, in the same run: the seam is ledgered as
    // ordinary debt, so it counts toward `ledger-size` and the permanence rule
    // never sees it — a claim spelled in prose is a reason like any other.
    expect(result.violations).toEqual([]);
    expect(result.permanentKeys).toEqual([]);
    expect(result.permanentIssues).toEqual([]);
  });

  it('fails a shard that declares no entry type at all', async () => {
    const shards = await loadWritten({
      orders: ['export const entries = {', `  '${ORDERS_SEAM}': 'F3 Phase C — orders.',`, '};', ''].join(
        '\n',
      ),
    });
    const result = checkModuleBoundary({ sources: sources('orders') }, shards);
    expect(result.shardShapeIssues).toHaveLength(1);
    expect(result.shardShapeIssues[0]).toContain('orders declares no entry type');
  });

  it('accepts the declaration however it is wrapped', () => {
    // Prettier breaks a long declaration across lines, so the comparison is on
    // normalised whitespace rather than on one spelling of it.
    expect(
      declaredEntryType('export const entries:\n  Readonly<Record<string, LedgerEntry>> = {};'),
    ).toBe(CANONICAL_SHARD_ENTRY_TYPE);
    expect(declaredEntryType('export const entries = {};')).toBeNull();
    expect(declaredEntryType('export const entries: Record<string, string> = {};')).toBe(
      'Record<string, string>',
    );
  });

  it('says nothing about a shard built in memory — it has no file to declare a type in', () => {
    // Every other fixture in this file hands in a record, and none of them is a
    // file that got its declaration wrong.
    expect(shardShapeIssue('orders', undefined)).toBeNull();
  });

  it('holds over the shards on disk, and every one of them carries its source', async () => {
    const shards = await loadLedgerShards(ledgerDirectory());
    expect(shards.length).toBeGreaterThan(0);
    expect(shards.filter((loaded) => (loaded.source ?? '') === '')).toEqual([]);
    expect(
      shards
        .map((loaded) => shardShapeIssue(loaded.moduleId, loaded.source))
        .filter((issue) => issue !== null),
    ).toEqual([]);
  });
});
