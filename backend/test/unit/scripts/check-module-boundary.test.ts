import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  checkModuleBoundary,
  collectModuleFiles,
  collectSchemaFiles,
  findCrossModuleSql,
  generatedExemptionIssues,
  isPermanent,
  keyOf,
  ledgerDirectory,
  loadLedgerShards,
  permanentEntryIssue,
  sourcesOf,
  vacuousReason,
  type LedgerEntry,
  type LedgerShard,
} from '../../../scripts/check-module-boundary.js';

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
      "import { orderSchema } from '@b2b/contracts';",
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

describe('checkModuleBoundary — refusing a vacuous pass (FR-021)', () => {
  const READ_SOMETHING = {
    moduleFiles: 1309,
    ledgerDirectoryExists: true,
    entityTables: 220,
    migrationTables: 241,
  };

  it('reports a reason when the module walk returned nothing', () => {
    expect(vacuousReason({ ...READ_SOMETHING, moduleFiles: 0 })).toMatch(
      /no module sources under src\/ — refusing to report a vacuous pass/,
    );
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
    const shards = await loadLedgerShards(ledgerDirectory());
    const sources = sourcesOf(collectModuleFiles());
    const schema = sourcesOf(collectSchemaFiles());
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
  });

  it('scans the same files the CLI scans, and the walk is the shared one', () => {
    // Both callers agree on the scan scope by construction rather than by two
    // similar walks — `check-container-imports.ts`' precedent.
    const files = collectModuleFiles();
    const srcRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'src');
    expect(files.length).toBe(countTypeScriptFiles(join(srcRoot, 'modules')) + countTypeScriptFiles(join(srcRoot, 'apps')));
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
          continue;
        }
        expect(entry.length, where).toBeGreaterThan(20);
      }
    }
  });

  it('is a directory of module-named files and nothing else', () => {
    const names = readdirSync(ledgerDirectory());
    expect(names.filter((name) => !name.endsWith('.ts'))).toEqual([]);
    const modules = new Set(
      collectModuleFiles()
        .map((file) => file.slice(file.indexOf('/src/') + '/src/'.length))
        .map((file) => file.split('/'))
        .map((segments) => (segments[0] === 'apps' ? segments[3] : segments[1])),
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
