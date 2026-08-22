/**
 * The package half of the three owner maps (feature 080, T034).
 *
 * Every case here enters at the **top** of the analysis (issue #130): a package
 * tree on disk, enumerated by `scanNodeModulesRoots`, subpath-resolved by Node's
 * own resolver, imported, and read for MikroORM metadata — the same path
 * `package-runtime.ts` walks at boot. A case that handed
 * `loadPackageDeclarations` a pre-built record would prove the reporter and
 * leave the enumeration, the resolution and the metadata read — the three parts
 * that can go blind — untested.
 *
 * The instance directory is created **inside the repository** for one reason
 * each way: the root has to be called `node_modules` or Node's `exports`
 * resolution cannot find a subpath, and it has to sit under a directory with the
 * repository's `node_modules` above it or `@mikro-orm/core` — an optional peer a
 * real package receives from the host — resolves nowhere.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadPackageDeclarations,
  packageCoverage,
  unreadablePackageReason,
  type PackageDeclarations,
} from '../../../scripts/lib/package-declarations.js';
import { GlobalEntity } from '../../../src/tenancy/org-scoped.decorator.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'fixtures', 'installed-packages');
/** Under `backend/test/`, so the repository's `node_modules` is above it. */
const SCRATCH = join(HERE, '..', '..', '.installed-package-instances');

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/**
 * An instance whose `node_modules` holds the named fixture packages.
 *
 * One directory per case, never one shared: `package-runtime.ts` memoises its
 * scan per root list, and a case that reused a root would be reading another
 * case's answer.
 */
function instanceWith(...packages: readonly string[]): string {
  mkdirSync(SCRATCH, { recursive: true });
  const root = mkdtempSync(join(SCRATCH, 'instance-'));
  created.push(root);
  for (const name of packages) {
    const destination = join(root, 'node_modules', '@fixture', name);
    mkdirSync(destination, { recursive: true });
    cpSync(join(FIXTURES, name), destination, { recursive: true });
  }
  return join(root, 'node_modules');
}

/** The analyzer `check-port-dependencies.ts` supplies, in miniature. */
function containerNames(source: string): { name: string; gated: boolean }[] {
  const found: { name: string; gated: boolean }[] = [];
  for (const match of source.matchAll(/providePort\(\s*'([^']+)'/g)) {
    found.push({ name: match[1]!, gated: true });
  }
  for (const match of source.matchAll(/di\.register\(\{\s*([A-Za-z0-9_]+)\s*:/g)) {
    found.push({ name: match[1]!, gated: false });
  }
  return found;
}

describe('installed-package declarations — the readable case', () => {
  it('attributes a package entity, its table and its migration DDL to the package module id', async () => {
    const scan = await loadPackageDeclarations({ roots: [instanceWith('mod-widgets')] });

    expect(scan.discovered).toBe(1);
    expect(scan.unreadable).toEqual([]);
    expect(scan.entities.map((entity) => [entity.className, entity.table, entity.moduleId])).toEqual(
      [['FixtureWidget', 'fixture_widgets', 'fixture_widgets']],
    );
    // The join table no entity declares: the second owner-map source, read from
    // the package's own migration files rather than through T033's registry.
    expect(scan.tables).toContainEqual({
      table: 'fixture_widget_tags',
      moduleId: 'fixture_widgets',
      packageName: '@fixture/mod-widgets',
      source: 'migration',
    });
    expect(scan.filesRead).toBeGreaterThan(0);
  });

  it('reads the table out of the artefact, which no source-text probe can do', async () => {
    const scan = await loadPackageDeclarations({ roots: [instanceWith('mod-widgets')] });
    const artefact = scan.entities[0]!.file;
    // The published shape: the decorator is a call, so the text the repository's
    // own entity walk looks for is not in the file that declares the entity.
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(artefact, 'utf8')).not.toContain('@Entity(');
    expect(scan.entities[0]!.table).toBe('fixture_widgets');
  });

  it('reads the container names a package registers, gated and plain', async () => {
    const scan = await loadPackageDeclarations({
      roots: [instanceWith('mod-widgets')],
      containerNames,
    });
    expect(scan.containerNames).toEqual([
      {
        name: 'fixtureWidgetReadPort',
        gated: true,
        moduleId: 'fixture_widgets',
        packageName: '@fixture/mod-widgets',
      },
      {
        name: 'fixtureWidgetRenderers',
        gated: false,
        moduleId: 'fixture_widgets',
        packageName: '@fixture/mod-widgets',
      },
    ]);
  });

  it('a package that publishes no backend and no migrations is readable and empty', async () => {
    const scan = await loadPackageDeclarations({ roots: [instanceWith('mod-admin-only')] });
    expect(scan.discovered).toBe(1);
    expect(scan.unreadable).toEqual([]);
    expect(scan.entities).toEqual([]);
    expect(scan.tables).toEqual([]);
  });
});

describe('installed-package declarations — Principle XI', () => {
  it('reports a package entity that carries no tenant-scope decorator', async () => {
    const scan = await loadPackageDeclarations({ roots: [instanceWith('mod-widgets')] });
    expect(scan.entities[0]!.classifications).toEqual([]);
  });

  it('reports the classification when it is in the registry the platform reads', async () => {
    const root = instanceWith('mod-widgets');
    const first = await loadPackageDeclarations({ roots: [root] });
    expect(first.entities[0]!.classifications).toEqual([]);

    // What a published kernel would do for a package author: classify the class
    // into the one registry the global filters are built from. The read is by
    // class identity, so this is the same object the loader saw.
    const { FixtureWidget } = (await import(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- a fixture artefact, imported the way the loader imports it.
      (await import('node:url')).pathToFileURL(first.entities[0]!.file).href
    )) as { FixtureWidget: new () => object };
    GlobalEntity()(FixtureWidget);

    const second = await loadPackageDeclarations({ roots: [root] });
    expect(second.entities[0]!.classifications).toEqual(['GlobalEntity']);
  });
});

describe('installed-package declarations — the refusals', () => {
  it('refuses a package that ships migrations and declares no entities', async () => {
    const scan = await loadPackageDeclarations({
      roots: [instanceWith('mod-schema-without-entities')],
    });
    expect(scan.unreadable).toHaveLength(1);
    expect(scan.unreadable[0]!.moduleId).toBe('fixture_schema_only');
    expect(scan.unreadable[0]!.reason).toContain('declares no `entities`');
    expect(unreadablePackageReason(scan)).toContain('refusing to report a vacuous pass');
  });

  it('refuses an artefact whose registrations cannot be read — only for the half that asks', async () => {
    const root = instanceWith('mod-bundled');
    // The entity half does not consult the container names, so it is not made to
    // fail by a question it never asked.
    expect((await loadPackageDeclarations({ roots: [root] })).unreadable).toEqual([]);

    const asked = await loadPackageDeclarations({ roots: [root], containerNames });
    expect(asked.unreadable).toHaveLength(1);
    expect(asked.unreadable[0]!.reason).toContain('does not name');
  });

  it('names every unreadable package in the refusal, and none when all were read', async () => {
    const clean = await loadPackageDeclarations({ roots: [instanceWith('mod-widgets')] });
    expect(unreadablePackageReason(clean)).toBeNull();

    const mixed = await loadPackageDeclarations({
      roots: [instanceWith('mod-widgets', 'mod-schema-without-entities')],
    });
    expect(mixed.discovered).toBe(2);
    expect(unreadablePackageReason(mixed)).toContain('@fixture/mod-schema-without-entities');
    expect(unreadablePackageReason(mixed)).toContain('1 of the 2 installed module package(s)');
  });
});

describe('installed-package declarations — the read: line', () => {
  it('declares no expectation when nothing is installed, so the floor is absent rather than off', async () => {
    const scan = await loadPackageDeclarations({ roots: [instanceWith()] });
    expect(scan.discovered).toBe(0);
    // `readSizeRefusal` refuses an expectation of zero; a checkout with no
    // package installed has none to make.
    expect(packageCoverage(scan)).toBeNull();
  });

  it('corroborates the walk against the packages npm actually installed', async () => {
    const scan = await loadPackageDeclarations({
      roots: [instanceWith('mod-widgets', 'mod-admin-only')],
    });
    expect(packageCoverage(scan)).toEqual({
      source: 'installed-packages',
      expected: 2,
      covered: 2,
    });
  });

  it('a shortfall is visible in the coverage as well as in the refusal', async () => {
    const scan: PackageDeclarations = await loadPackageDeclarations({
      roots: [instanceWith('mod-widgets', 'mod-schema-without-entities')],
    });
    expect(packageCoverage(scan)).toEqual({
      source: 'installed-packages',
      expected: 2,
      covered: 1,
    });
  });
});
