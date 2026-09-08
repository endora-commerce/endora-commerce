import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSplitModuleTreeFixture,
  packagedModuleIds,
  type MovedModuleTreeFixture,
} from '../../helpers/moved-module-tree-fixture.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import { modulePackages } from '../../../scripts/generate-composer.js';
import { resolveModuleLayout, type ModuleTreeLayout } from '../../../scripts/lib/module-roots.js';
import type { ModulePackage } from '../../../scripts/lib/module-packages.js';
import {
  buildScaffold,
  classNameFromFile,
  listMigrationDirs,
  migrationTargetFor,
  refuseUnregisterableTarget,
  takenStamps,
} from '../../../scripts/new-migration.js';

/**
 * `migration:new` finds a module wherever the platform keeps one.
 *
 * The scaffolder's **pure** halves — the filename, the class name, the stamp
 * clamp — have been covered since feature 065 in
 * test/unit/db/new-migration-scaffolder.test.ts. Its **roots** were not, and
 * that is precisely what broke: all three of them were spelled
 * `backend/src/modules`, which `specs/080-f4-real-scope/`'s packaging sweep
 * emptied on 2026-08-28. Every registered module id was then rejected (`Valid
 * ids are: core.`), the stamp-uniqueness walk narrowed from the whole tree to
 * the core block, and the output path the tool would have produced for an
 * accepted id named a directory the packaged module does not read — a migration
 * that compiles, sits in the diff and never runs.
 *
 * A test that exercised the pure helpers again would have caught none of it, so
 * every case here drives the derivation over a **tree**: the split fixture for
 * the spawned CLI, and the real checkout for the walk the CLI reconciles its
 * stamps against.
 */

const PROBE_SLUG = 'scaffold_roots_probe';

/** A module this repository really ships as a workspace package. */
const PACKAGED_MODULE = ((): string => {
  const [first] = packagedModuleIds();
  if (first === undefined) {
    throw new Error(
      'this repository declares no module package, so the packaged half of the derivation has ' +
        'nothing to resolve. Do not weaken this file to make it pass — a checkout with no ' +
        'module package cannot measure the defect it exists to refuse.',
    );
  }
  return first;
})();

describe('migration:new resolves a module wherever it lives (spawned over a split tree)', () => {
  let fixture: MovedModuleTreeFixture;

  beforeAll(() => {
    // No relocation pool: this repository has nothing left under
    // `backend/src/modules` to move, and the fixture copies every real module
    // package to `packages/modules/<id>/` regardless — which is the tree the
    // defect was found on.
    fixture = createSplitModuleTreeFixture({ packaged: [] });
  }, 120_000);

  afterAll(() => fixture?.cleanup());

  const scaffold = (moduleId: string): { status: number | null; output: string } =>
    fixture.run('new-migration.ts', ['--module', moduleId, '--name', PROBE_SLUG]);

  it('writes a packaged module’s migration into that package, not into the application', () => {
    const result = scaffold(PACKAGED_MODULE);
    expect(result.output).not.toContain('Unknown module id');
    expect(result.status).toBe(0);

    const directory = join(fixture.root, 'packages', 'modules', PACKAGED_MODULE, 'src', 'migrations');
    const written = readdirSync(directory).filter((name) => name.includes(PROBE_SLUG));
    expect(written).toHaveLength(1);

    // The naming contract is unchanged and is re-derived here rather than
    // spelled: `specs/065-manifest-aware-migrations/contracts/naming-convention.md`
    // §1 and §2, with the tail opening on the owning module's segment, which is
    // what makes the persisted class name unique across every module the
    // platform can compose.
    const filename = written[0]!;
    expect(filename).toMatch(
      new RegExp(`^\\d{8}T\\d{6}_${PACKAGED_MODULE.replace(/^_/, '')}_${PROBE_SLUG}\\.ts$`),
    );
    expect(readFileSync(join(directory, filename), 'utf8')).toContain(
      `export class ${classNameFromFile(filename)} extends Migration {`,
    );
    expect(result.output).toContain(
      `packages/modules/${PACKAGED_MODULE}/src/migrations/${filename}`,
    );
    // `backend/src/modules/<id>/migrations` is where this went before the
    // repair, and the packaged module reads nothing there.
    expect(
      existsSync(join(fixture.root, 'backend', 'src', 'modules', PACKAGED_MODULE)),
    ).toBe(false);
  });

  it("puts --module core in the platform's own migrations directory", () => {
    // It was `backend/src/db/migrations` until `specs/110-instance-repository/`
    // T116 moved the twelve beside the `./migrations` barrel that publishes
    // them. The path is the scaffolder's own resolution — the one workspace
    // member declaring `endora.type: "platform"` — which this fixture stages,
    // so what is asserted is where the tool really writes rather than where a
    // literal says it should.
    const result = scaffold('core');
    expect(result.status).toBe(0);
    const directory = join(fixture.root, 'packages', 'platform', 'src', 'migrations');
    const written = readdirSync(directory).filter((name) => name.includes(PROBE_SLUG));
    expect(written).toEqual([expect.stringMatching(/^\d{8}T\d{6}_core_scaffold_roots_probe\.ts$/)]);
    expect(result.output).toContain(`packages/platform/src/migrations/${written[0]!}`);
    // And not where it used to go: a scaffolder that fell back would write a
    // file into a directory the generator no longer walks, and an unregistered
    // migration does not run.
    expect(existsSync(join(fixture.root, 'backend', 'src', 'db', 'migrations'))).toBe(false);
  });

  it('refuses an unknown id and names the real modules, not core alone', () => {
    const result = scaffold('ghost');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Unknown module id "ghost"');
    // The regression in one assertion: the refusal used to read
    // `Valid ids are: core.` on a tree holding every one of these.
    expect(result.output).toContain(PACKAGED_MODULE);
    for (const id of packagedModuleIds().slice(0, 8)) expect(result.output).toContain(id);
  });

  it('refuses a target the registry generator would not register', () => {
    // `_lifecycle` is a registered module whose sources the host owns
    // (D-160.11). Its directory is under the platform package, so a migration
    // written there matches none of the generator's three shapes and would be
    // skipped in silence — the same defect one layer along.
    const result = scaffold('_lifecycle');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('registered by nothing');
    expect(
      existsSync(join(fixture.root, 'packages', 'platform', 'src', 'lifecycle', 'migrations')),
    ).toBe(false);
  });
});

describe('the stamp-uniqueness walk reads the whole tree', () => {
  let layout: ModuleTreeLayout;
  let packages: readonly ModulePackage[];

  beforeAll(async () => {
    layout = await resolveModuleLayout();
    packages = modulePackages();
  });

  it('offers a directory for every registered module, plus core', () => {
    const dirs = listMigrationDirs(layout, packages);
    expect(dirs).toHaveLength(layout.registeredIds.length + 1);
    for (const id of layout.registeredIds) {
      expect(dirs).toContain(migrationTargetFor(id, layout, packages).directory);
    }
  });

  /**
   * Reconciled against the committed registry rather than against a number.
   *
   * The registry is a second author's answer to "which migrations exist": its
   * class names are what `mikro_orm_migrations` persists, and the stamp is the
   * first fifteen characters of each. Before the repair the walk saw the twelve
   * core stamps out of 167 and reported a free stamp against the other 155
   * without ever having looked at them.
   */
  it('sees every stamp the committed migrations registry holds', () => {
    const registered = new Set(
      MIGRATION_REGISTRY.map((entry) => {
        const match = /^Migration(\d{8}T\d{6})/.exec(entry.cls.name);
        if (match === null) {
          throw new Error(`${entry.cls.name} is not named per naming-convention.md §2`);
        }
        return match[1]!;
      }),
    );
    expect(registered.size).toBeGreaterThan(100);
    const walked = takenStamps(layout, packages);
    expect([...registered].filter((stamp) => !walked.has(stamp))).toEqual([]);
  });
});

describe('migrationTargetFor — one derivation, three layouts', () => {
  const layoutOver = (directories: Readonly<Record<string, string>>): ModuleTreeLayout =>
    ({
      manifestIndexPath: '/checkout/backend/src/manifest-index.generated.ts',
      registeredIds: Object.keys(directories),
      moduleDirectoryOf: (id: string) => directories[id] ?? null,
    }) as unknown as ModuleTreeLayout;

  const DIR = '/checkout/packages/modules/orders';
  const packageFor = (
    exportPairs: ReadonlyArray<readonly [string, string]>,
    emit: { rootDir: string; outDir: string } | null,
  ): ModulePackage =>
    ({
      moduleId: 'orders',
      name: '@endora-commerce/mod-orders',
      dir: DIR,
      exports: new Map(exportPairs),
      emit,
    }) as unknown as ModulePackage;

  it('puts an application-tree module’s migrations beside its manifest', () => {
    const layout = layoutOver({ orders: '/checkout/backend/src/modules/orders' });
    expect(migrationTargetFor('orders', layout, [])).toEqual({
      moduleId: 'orders',
      directory: join('/checkout/backend/src/modules/orders', 'migrations'),
      owner: null,
    });
  });

  // Three package shapes, one answer. The declared target names the build
  // output for a package that builds (D-164) and the source itself for one that
  // does not, and a package with no migrations yet declares no such subpath at
  // all — so a rule reading the target literally, or one spelling `src`, is
  // wrong for a different one of the three each time.
  it.each([
    [
      'a built package that already publishes ./migrations',
      packageFor(
        [
          ['.', './dist/manifest.js'],
          ['./migrations', './dist/migrations/index.js'],
        ],
        { rootDir: 'src', outDir: 'dist' },
      ),
    ],
    [
      'a source-shipping package that already publishes ./migrations',
      packageFor(
        [
          ['.', './src/manifest.ts'],
          ['./migrations', './src/migrations/index.ts'],
        ],
        null,
      ),
    ],
    [
      'a built package whose first migration this is',
      packageFor([['.', './dist/manifest.js']], { rootDir: 'src', outDir: 'dist' }),
    ],
  ])('resolves the package’s own migrations layer — %s', (_label, pkg) => {
    const layout = layoutOver({ orders: DIR });
    expect(migrationTargetFor('orders', layout, [pkg])).toEqual({
      moduleId: 'orders',
      directory: join(DIR, 'src', 'migrations'),
      owner: pkg,
    });
  });

  it('keeps core on the directory the caller names', () => {
    const layout = layoutOver({});
    expect(
      migrationTargetFor('core', layout, [], '/checkout/packages/platform/src/migrations'),
    ).toEqual({
      moduleId: 'core',
      directory: '/checkout/packages/platform/src/migrations',
      owner: null,
    });
  });

  it('refuses a registered module whose sources no root holds', () => {
    const layout = layoutOver({});
    expect(() => migrationTargetFor('ghost', layout, [])).toThrow(/no directory holds its sources/);
  });
});

describe('refuseUnregisterableTarget', () => {
  const root = join(process.cwd(), 'test-fixture-unregisterable');
  const scaffold = buildScaffold({ moduleId: 'orders', slug: 'probe', stamp: '20260901T090000' });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('accepts an application-tree module the generator recognises', () => {
    const directory = join(root, 'src', 'modules', 'orders', 'migrations');
    expect(() =>
      refuseUnregisterableTarget(
        { moduleId: 'orders', directory, owner: null },
        join(directory, scaffold.filename),
        scaffold,
        [join(root, 'src')],
      ),
    ).not.toThrow();
  });

  it("accepts the core block, at the platform's own migrations root", () => {
    // `specs/110-instance-repository/` T116: the twelve moved to
    // `packages/platform/src/migrations/`, so the walked root the generator
    // keys them under is the platform's source root and the key is
    // `migrations/<file>`. The walk roots are the parameter here precisely so
    // that this case names the layout it is about rather than the checkout's.
    const platformSrc = join(root, 'packages', 'platform', 'src');
    const directory = join(platformSrc, 'migrations');
    const core = buildScaffold({ moduleId: 'core', slug: 'probe', stamp: '20260901T090000' });
    expect(() =>
      refuseUnregisterableTarget(
        { moduleId: 'core', directory, owner: null },
        join(directory, core.filename),
        core,
        [join(root, 'src'), platformSrc],
      ),
    ).not.toThrow();
  });

  it('refuses a directory under no walked root', () => {
    // The shape `_lifecycle` is in: a real module directory that the
    // generator's walk keys under neither the application nor a package.
    const directory = join(root, 'packages', 'platform', 'src', 'lifecycle', 'migrations');
    mkdirSync(directory, { recursive: true });
    expect(() =>
      refuseUnregisterableTarget(
        { moduleId: '_lifecycle', directory, owner: null },
        join(directory, scaffold.filename),
        scaffold,
        [join(root, 'src')],
      ),
    ).toThrow(/registered by nothing/);
  });
});
