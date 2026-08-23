/**
 * The composer's notion of a module package (feature 080, T041a; D-149).
 *
 * `generate-composer.ts` had none. All four artefacts were rooted at
 * `backend/src`: both discovery walks listed `<src>/modules`, `readSourceTree`
 * walked `<src>` and skipped `node_modules` by name, `MODULE_MIGRATION_RE` was
 * anchored at `^modules/<id>/migrations/`, and `specifierFromDb` emitted a
 * relative path and nothing else. The consequence is not a build error: a module
 * that had become a package simply left every artefact, and the one where an
 * absence is invisible is the **migration registry** — an unregistered migration
 * does not run, `migration:pending` reports nothing pending, and the first
 * symptom is a query against a table that was never created.
 *
 * Every fixture below enters at the top: a real checkout on disk holding a
 * module in each of the three places one can be, and the generator's own
 * discovery run over it. Nothing here hands a pre-classified record to a
 * renderer (issue #130) — the package model, the specifiers and the containment
 * verdicts are all computed from the fixture's `package.json` files and its
 * `pnpm-workspace.yaml`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';

import {
  createModulePackageFixture,
  type ModulePackageFixture,
} from '../../helpers/module-package-fixture.js';
import {
  discoverModulePackages,
  isDeclaredEntryPoint,
  ModulePackageError,
  packageSpecifierFor,
  type ModulePackage,
} from '../../../scripts/lib/module-packages.js';
import {
  collectEntities,
  collectMigrations,
  coreSources,
  emitEntitiesRegistry,
  emitMigrationsRegistry,
  mergeSources,
  packageSources,
} from '../../../scripts/generate-composer.js';
import {
  classifySpecifier,
  containmentSites,
  permittedRoots,
} from '../../../scripts/check-overlay-determinism.js';

let fixture: ModulePackageFixture;
let packages: readonly ModulePackage[];
let alpha: ModulePackage;
let gamma: ModulePackage;

const MIGRATION_FILE = 'src/migrations/20260810T101500_alpha_initial.ts';
const MIGRATION_SOURCE = 'export class Migration20260810T101500AlphaInitial {}\n';
const ENTITY_FILE = 'src/backend/entities/alpha-thing.entity.ts';
const ENTITY_SOURCE = '@Entity()\nexport class AlphaThing {}\n';

beforeAll(() => {
  fixture = createModulePackageFixture();
  packages = discoverModulePackages(fixture.root);
  alpha = packages.find((pkg) => pkg.moduleId === 'alpha')!;
  gamma = packages.find((pkg) => pkg.moduleId === 'gamma')!;
});

afterAll(() => {
  fixture?.cleanup();
});

describe('discovery: a workspace module package, and only that', () => {
  it('finds the declared workspace members by their own endora blocks', () => {
    expect(packages.map((pkg) => [pkg.moduleId, pkg.name])).toEqual([
      ['alpha', '@endora-commerce/mod-alpha'],
      ['gamma', '@endora-commerce/mod-gamma'],
    ]);
    expect(alpha.dir).toBe(fixture.workspacePackage.dir);
    expect(gamma.dir).toBe(fixture.builtPackage.dir);
  });

  it('does not find the installed one, which is the whole of D-119/D-155', () => {
    // The two packages are the same shape — scoped name, `endora` block,
    // `exports` map, an entity and a migration — so this is a statement about
    // *where* it is and not about how it is written. An installed package
    // contributes to the running platform at runtime; baking it into a
    // committed artefact registers it twice.
    expect(packages.map((pkg) => pkg.moduleId)).not.toContain('beta');
  });
});

describe('the specifier the generator emits, per origin', () => {
  it('is bare for a packaged file, derived from that package’s own exports map', () => {
    expect(packageSpecifierFor(alpha, MIGRATION_FILE)).toBe(
      '@endora-commerce/mod-alpha/migrations',
    );
    // The entity sits two directories below `./backend`'s target, and the
    // barrel-covers-its-directory rule is what reaches it. Nothing here spells
    // `./backend`: the fixture's manifest does.
    expect(packageSpecifierFor(alpha, ENTITY_FILE)).toBe('@endora-commerce/mod-alpha/backend');
    // The root subpath is the package name alone, never `<name>/.`.
    expect(packageSpecifierFor(alpha, 'src/manifest.ts')).toBe('@endora-commerce/mod-alpha');
  });

  it('is relative for the application’s own tree, exactly as before', () => {
    const rendered = emitEntitiesRegistry(
      collectEntities(coreSources({ 'modules/blog/entities/post.entity.ts': ENTITY_SOURCE })),
    );
    expect(rendered).toContain("from '../modules/blog/entities/post.entity.js'");
  });

  it('carries both, in one artefact, from one walk', () => {
    const rendered = emitMigrationsRegistry(
      collectMigrations(
        mergeSources(
          coreSources({
            'db/migrations/20260810T101500_core_initial.ts':
              'export class Migration20260810T101500CoreInitial {}\n',
          }),
          packageSources(alpha, { [MIGRATION_FILE]: MIGRATION_SOURCE }),
        ),
      ),
    );

    expect(rendered).toContain("from './migrations/20260810T101500_core_initial.js'");
    expect(rendered).toContain("from '@endora-commerce/mod-alpha/migrations'");
    // And the packaged migration is attributed to the id its package declares,
    // not to a path segment: a hard uninstall reverts exactly the migrations
    // registered under the module being removed.
    expect(rendered).toContain("migration('alpha', Migration20260810T101500AlphaInitial)");
  });

  it('follows a `dist`-shipping package’s build declaration, not its source layout', () => {
    // D-164: a module package ships compiled output, so its `exports` targets
    // name `dist/**.js` while the generator's walk reads `src/**.ts`. Matching
    // one against the other refuses **every** file of a conforming package —
    // measured, before this branch: all four of `blog`'s shapes raised "no
    // subpath covers it". The mapping is read from the package's own
    // `tsconfig.build.json`, following its relative `extends` because the
    // fixture puts `rootDir` in the build file and `outDir` in the file it
    // extends, exactly as every package in this repository does.
    expect(gamma.emit).toEqual({ rootDir: 'src', outDir: 'dist' });
    expect(packageSpecifierFor(gamma, 'src/manifest.ts')).toBe('@endora-commerce/mod-gamma');
    expect(packageSpecifierFor(gamma, ENTITY_FILE)).toBe('@endora-commerce/mod-gamma/backend');
    expect(packageSpecifierFor(gamma, MIGRATION_FILE)).toBe(
      '@endora-commerce/mod-gamma/migrations',
    );
  });

  it('keeps the source-shipping answer, so the mapping is a mapping and not a `dist` prefix', () => {
    // The discrimination. `alpha` declares no build configuration at all, so it
    // publishes what the walk read and its paths must match unchanged — a
    // derivation that simply prefixed `dist/` would break it, and a fixture
    // holding only one regime would not notice.
    expect(alpha.emit).toBeNull();
    expect(packageSpecifierFor(alpha, 'src/manifest.ts')).toBe('@endora-commerce/mod-alpha');
  });

  it('names the barrel a `./migrations` subpath points at as an entry point, not a stray', () => {
    // What lets `collectMigrations` tell the barrel from a misnamed migration
    // without an allow-list entry per package: the file a subpath points **at**
    // is an entry point by declaration.
    expect(isDeclaredEntryPoint(gamma, 'src/migrations/index.ts')).toBe(true);
    expect(isDeclaredEntryPoint(gamma, MIGRATION_FILE)).toBe(false);
    expect(isDeclaredEntryPoint(alpha, 'src/migrations/index.ts')).toBe(true);
  });

  it('refuses a file the package’s exports map does not cover', () => {
    // Not skipped. A committed registry imports by that specifier, so an
    // uncovered file would be registered under one the package answers
    // ERR_PACKAGE_PATH_NOT_EXPORTED to — and dropping it instead is how a
    // migration goes missing without a word.
    expect(() => packageSpecifierFor(alpha, 'test/unit/stray.ts')).toThrow(ModulePackageError);
    expect(() => packageSpecifierFor(alpha, 'test/unit/stray.ts')).toThrow(/exports map/);
  });
});

describe('overlay:check’s foreign verdict, exercised both ways (D-155.6)', () => {
  /** The roots a run over the fixture checkout derives — never a hand-written list. */
  const rootsOf = (f: ModulePackageFixture) => permittedRoots(f.root);
  /** Where a rendered `db/` artefact sits in the fixture, which decides the resolution start. */
  const artefactOf = (f: ModulePackageFixture) =>
    join(f.backendSrc, 'db', 'entities-registry.generated.ts');

  it('accepts the workspace package’s bare specifier (D-149)', () => {
    const site = classifySpecifier(
      artefactOf(fixture),
      '@endora-commerce/mod-alpha/migrations',
      rootsOf(fixture),
    );

    expect(site.verdict).toBe('workspace-package');
    expect(site.resolved).toBe(fixture.workspacePackage.dir);
  });

  it('refuses the installed package’s, which is the same specifier shape', () => {
    const site = classifySpecifier(
      artefactOf(fixture),
      '@vendor/mod-beta/migrations',
      rootsOf(fixture),
    );

    expect(site.verdict).toBe('foreign');
    expect(site.detail).toContain('node_modules');
  });

  it('makes that discrimination over a real rendered artefact, not two lone specifiers', () => {
    // The pair in one artefact, so the proof cannot pass by seeing nothing: the
    // emitter runs, the containment pass reads its text, and exactly one entry
    // is foreign.
    const rendered = emitMigrationsRegistry(
      collectMigrations(
        mergeSources(
          packageSources(alpha, { [MIGRATION_FILE]: MIGRATION_SOURCE }),
          coreSources({
            'db/migrations/20260810T101500_core_initial.ts':
              'export class Migration20260810T101500CoreInitial {}\n',
          }),
        ),
      ),
    ).replace(
      "export type { MigrationClass, MigrationRegistryEntry };",
      // The installed package's entry, which the generator will not emit and
      // which the containment pass must refuse if it ever did.
      "import { MigrationBeta } from '@vendor/mod-beta/migrations';\n" +
        'export type { MigrationClass, MigrationRegistryEntry };',
    );

    const foreign = containmentSites(artefactOf(fixture), rendered, rootsOf(fixture)).filter(
      (site) => site.verdict === 'foreign',
    );

    expect(foreign.map((site) => site.specifier)).toEqual(['@vendor/mod-beta/migrations']);
  });
});

describe('this repository, which has no module package yet', () => {
  it('reports none, so every committed artefact stays relative', () => {
    // The control for the whole file: the fixture proves the package path, and
    // this proves the repository is not silently on it. When the first module
    // package lands, this assertion is the one that has to change, in the merge
    // request that lands it.
    const here = discoverModulePackages(join(fixture.root, '..', 'nowhere-at-all'));
    expect(here).toEqual([]);
  });
});
