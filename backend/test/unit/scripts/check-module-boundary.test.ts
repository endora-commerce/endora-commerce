import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  checkModuleBoundary,
  collectModuleFiles,
  generatedExemptionIssues,
  keyOf,
  ledgerDirectory,
  loadLedgerShards,
  sourcesOf,
  vacuousReason,
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

function shard(moduleId: string, entries: Record<string, string>): LedgerShard {
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

describe('checkModuleBoundary — the five ways the ledger fails', () => {
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
  it('reports a reason when the module walk returned nothing', () => {
    expect(vacuousReason({ moduleFiles: 0, ledgerDirectoryExists: true })).toMatch(
      /no module sources under src\/ — refusing to report a vacuous pass/,
    );
  });

  it('reports a reason when the ledger directory is missing', () => {
    expect(vacuousReason({ moduleFiles: 1309, ledgerDirectoryExists: false })).toMatch(
      /ledger directory missing — refusing to report a vacuous pass/,
    );
  });

  it('reports no reason when it read both', () => {
    expect(vacuousReason({ moduleFiles: 1309, ledgerDirectoryExists: true })).toBeNull();
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
  it('has every cross-module import ledgered, in its own shard', async () => {
    const shards = await loadLedgerShards(ledgerDirectory());
    const sources = sourcesOf(collectModuleFiles());
    expect(sources.size, 'no module sources found — a vacuous pass').toBeGreaterThan(1000);

    const result = checkModuleBoundary({ sources }, shards);
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
      for (const [key, reason] of Object.entries(loaded.entries)) {
        expect(reason.length, `${loaded.moduleId}: ${key}`).toBeGreaterThan(20);
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
