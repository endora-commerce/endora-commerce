/**
 * The entity index a host generates — the renderer, its refusal and the proof
 * that a tree outside this checkout builds a row through it
 * (`specs/109-backend-test-kit/tasks.md` T065).
 *
 * ## What is being proved, and why a fixture tree is the only way to prove it
 *
 * A server-bound test writes rows, and to write one it needs the entity class
 * **the ORM registered** (D-160.6.1). A module package publishes one `entities`
 * array and no entity class by name (D-168), so a host picks the class out of
 * that array — and *which packages are installed* is the one fact
 * `@endora-commerce/test-kit` may not know (109 R2.2, FR-001). That is why
 * `backend/test/helpers/package-entities.ts` is permanently host-owned
 * (`module-package-layout.md` R10's closing paragraph) and why the successor is a
 * **generated per-host artefact**.
 *
 * The acceptance is therefore about a tree this repository does not contain:
 * *a host outside this checkout builds a row for an installed module's entity
 * through the generated index, with the kit declaring no module package.* So the
 * last case below builds a real `node_modules` in a temporary directory,
 * renders the artefact into it, and **spawns node** against it. Nothing in that
 * run names a path inside this checkout: the fixture module, the kit and the
 * platform are all resolved by node through the fixture tree's own
 * `node_modules`, which is what an installed consumer has and a `paths` entry
 * would have hidden.
 *
 * ## The fixtures enter at the top of the analysis
 *
 * Issue #130. The renderer is handed packages read off real manifests on disk by
 * the same `scanInstalledModulePackages` an instance's own `endora generate`
 * uses — never a pre-built entry list, which would pass over every defect in the
 * collection step.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  collectEntityIndexEntries,
  emitEntityIndex,
  entityIndexOutputPathIn,
  ENTITY_INDEX_EXPORT,
} from '../src/lib/entity-index-artefact.js';
import { ModulePackageError } from '../src/lib/module-packages.js';
import { scanInstalledModulePackages } from '../src/lib/module-packages.js';

const SCOPE = '@endora-commerce/';

/** This checkout's root, used **only** to link real packages into a fixture. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ei-'));
  scratch.push(dir);
  return dir;
}

interface FixtureModule {
  /** The module id its own `endora` block declares — the index's key (D-142). */
  readonly id: string;
  /** `exports`, overridden for the "declares no `./backend`" refusal. */
  readonly exports?: Readonly<Record<string, unknown>>;
  /** Extra files, package-relative, written verbatim. */
  readonly files?: Readonly<Record<string, string>>;
}

/**
 * A `node_modules/@endora-commerce` holding the given module packages.
 *
 * What an install produces, so the collection step is exercised on the evidence
 * it will really be given: `dist` and an `exports` map, with no `src/` and no
 * `tsconfig.build.json` — the shape `adminLayerSpecifierOf`'s two-question split
 * calls "an installed package".
 */
function installFixture(modules: readonly FixtureModule[]): string {
  const root = tempRoot();
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'backend'\n", 'utf8');
  for (const module of modules) {
    const dir = join(root, 'node_modules', SCOPE.slice(0, -1), `mod-${module.id}`);
    mkdirSync(join(dir, 'dist', 'backend'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: `${SCOPE}mod-${module.id}`,
        version: '9.9.9',
        type: 'module',
        endora: { type: 'module', id: module.id },
        exports:
          module.exports ??
          ({
            '.': { default: './dist/manifest.js' },
            './backend': { types: './dist/backend/index.d.ts', default: './dist/backend/index.js' },
          } as Record<string, unknown>),
        files: ['dist'],
      }),
      'utf8',
    );
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(
      join(dir, 'dist', 'manifest.js'),
      `export const manifest = { id: '${module.id}' };\n`,
      'utf8',
    );
    for (const [path, content] of Object.entries(module.files ?? {})) {
      const file = join(dir, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content, 'utf8');
    }
  }
  return root;
}

function entriesIn(root: string): ReturnType<typeof collectEntityIndexEntries> {
  return collectEntityIndexEntries(scanInstalledModulePackages(root).packages);
}

describe('collectEntityIndexEntries', () => {
  it('names every installed module by its id and its published `./backend`', () => {
    const root = installFixture([{ id: 'widgets' }, { id: 'billing' }]);
    expect(entriesIn(root)).toEqual([
      { moduleId: 'billing', specifier: `${SCOPE}mod-billing/backend` },
      { moduleId: 'widgets', specifier: `${SCOPE}mod-widgets/backend` },
    ]);
  });

  it('sorts by module id, so one install renders one artefact', () => {
    const forwards = entriesIn(installFixture([{ id: 'alpha' }, { id: 'zulu' }]));
    const backwards = entriesIn(installFixture([{ id: 'zulu' }, { id: 'alpha' }]));
    expect(forwards).toEqual(backwards);
  });

  it('refuses a module package that publishes no `./backend`, naming what it does', () => {
    // A skip is how a whole module goes missing from an index without a word,
    // and the failure then lands on whichever test asked for one of its entities
    // — `ModuleNotInstalledError` for a module the client did install.
    const root = installFixture([
      { id: 'widgets', exports: { '.': { default: './dist/manifest.js' }, './ports': './dist/ports/index.js' } },
    ]);
    let thrown: unknown;
    try {
      entriesIn(root);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ModulePackageError);
    const message = (thrown as Error).message;
    expect(message).toContain('mod-widgets');
    expect(message).toContain('./backend');
    expect(message).toContain('./ports');
  });

  it('reads an empty install as an empty index rather than as no answer', () => {
    expect(entriesIn(installFixture([]))).toEqual([]);
  });
});

describe('emitEntityIndex', () => {
  it('imports each module\'s array by its bare specifier and keys it by module id', () => {
    const source = emitEntityIndex([
      { moduleId: 'widgets', specifier: `${SCOPE}mod-widgets/backend` },
      { moduleId: '_i18n', specifier: `${SCOPE}mod-i18n/backend` },
    ]);
    expect(source).toContain(`import { entities as entities0 } from '${SCOPE}mod-widgets/backend';`);
    expect(source).toContain(`import { entities as entities1 } from '${SCOPE}mod-i18n/backend';`);
    expect(source).toContain(`export const ${ENTITY_INDEX_EXPORT}: Readonly<`);
    expect(source).toContain('  widgets: entities0,');
    // Every module id in this repository is a JS identifier — `_i18n`'s leading
    // underscore included — so the ordinary rendering is a bare key. The key is
    // the id and never a re-spelling of it: a test names the module it is
    // testing.
    expect(source).toContain('  _i18n: entities1,');
  });

  it('binds by position, and quotes an id that is not an identifier', () => {
    // A module id is not a JS identifier in general — a stranger's may hold a
    // hyphen — so the binding is positional and the key is quoted when it has
    // to be. An identifier *derived* from an id would be a second name for the
    // same thing that every reader has to undo.
    const source = emitEntityIndex([{ moduleId: 'pim-akeneo', specifier: 'x/backend' }]);
    expect(source).toContain("import { entities as entities0 } from 'x/backend';");
    expect(source).toContain("  'pim-akeneo': entities0,");
  });

  it('carries the do-not-edit header and names no module in its prose', () => {
    const source = emitEntityIndex([]);
    expect(source).toMatch(/DO NOT EDIT/);
    expect(source).toContain(`export const ${ENTITY_INDEX_EXPORT}: Readonly<`);
  });

  /**
   * The artefact declares no dependency of its own — deliberately.
   *
   * A `satisfies InstalledEntityIndex` would read better and would put a
   * **type-only import of `@endora-commerce/test-kit`** into a file every
   * instance renders, including the overwhelming majority that run no test and
   * never install the kit. The shape is checked where it is used, by the
   * argument position of `entityNamedIn`, which is the consumer that actually
   * needs it.
   */
  it('imports nothing but the installed modules', () => {
    const source = emitEntityIndex([{ moduleId: 'widgets', specifier: `${SCOPE}mod-widgets/backend` }]);
    const imports = source.split('\n').filter((line) => line.startsWith('import'));
    expect(imports).toEqual([`import { entities as entities0 } from '${SCOPE}mod-widgets/backend';`]);
  });
});

describe('entityIndexOutputPathIn', () => {
  it('lands in the backend member, outside its compiled source root', () => {
    // Outside `src`, because the member's own tsconfig sets `include: ['src']`
    // and `rootDir: 'src'`: a test artefact has no business in a production
    // build, and a `.ts` outside `rootDir` is TS6059 even for a type-only
    // import.
    expect(entityIndexOutputPathIn('/tmp/inst')).toBe('/tmp/inst/backend/test/entities.generated.ts');
  });
});

/**
 * **The acceptance.** A host outside this checkout builds a row for an installed
 * module's entity through the generated index, with the kit naming no module.
 *
 * Every resolution in the spawned run goes through the fixture tree's own
 * `node_modules`: the fixture module package, `@endora-commerce/test-kit` and
 * `@endora-commerce/platform`. The two real ones are **linked**, because the
 * alternative is packing and installing three tarballs per run; what matters for
 * the claim is that node resolves them by name from the fixture root rather than
 * that this checkout spelled a path into them — a `tsconfig` `paths` entry, which
 * is what hides this failure in-tree, does not exist in the spawned process at
 * all.
 */
describe('a host outside this checkout', () => {
  it('builds a row for an installed module\'s entity through the generated index', () => {
    const root = installFixture([
      {
        id: 'widgets',
        files: {
          // What a module package publishes on `./backend`: one `entities`
          // array, and **no entity class by name** (D-168). The driver below
          // cannot import `Widget`, which is the whole point.
          'dist/backend/index.js':
            'class Widget { constructor() { this.id = null; this.sku = null; } }\n' +
            'class WidgetRevision { constructor() { this.id = null; } }\n' +
            'export const entities = [Widget, WidgetRevision];\n',
          'dist/backend/index.d.ts':
            'export declare const entities: readonly (abstract new (...args: never[]) => object)[];\n',
        },
      },
      { id: 'billing', files: { 'dist/backend/index.js': 'export const entities = [];\n' } },
    ]);

    // Link the two real packages the host resolves by name. Nothing else from
    // this checkout is reachable from the spawned process.
    const scopeDir = join(root, 'node_modules', SCOPE.slice(0, -1));
    symlinkSync(join(repoRoot, 'packages', 'test-kit'), join(scopeDir, 'test-kit'), 'dir');
    symlinkSync(join(repoRoot, 'packages', 'platform'), join(scopeDir, 'platform'), 'dir');

    // The generator's output, written where it would really be written.
    const artefact = entityIndexOutputPathIn(root);
    mkdirSync(dirname(artefact), { recursive: true });
    writeFileSync(artefact, emitEntityIndex(entriesIn(root)), 'utf8');

    // The host's own test-side driver: the kit's lookup over the generated
    // index, exactly as a module package's server-bound test writes it.
    const driver = join(root, 'backend', 'test', 'build-a-row.ts');
    writeFileSync(
      driver,
      [
        "import { entityNamedIn, ModuleNotInstalledError } from '@endora-commerce/test-kit/support';",
        '',
        `import { ${ENTITY_INDEX_EXPORT} } from './entities.generated.ts';`,
        '',
        `const Widget = entityNamedIn(${ENTITY_INDEX_EXPORT}, 'widgets', 'Widget');`,
        'const row = new (Widget as unknown as new () => { id: string; sku: string })();',
        "row.id = 'w-1';",
        "row.sku = 'SKU-1';",
        '',
        'let refused = null;',
        'try {',
        `  entityNamedIn(${ENTITY_INDEX_EXPORT}, 'shipments', 'Shipment');`,
        '} catch (error) {',
        '  refused = error instanceof ModuleNotInstalledError ? error.installed : null;',
        '}',
        '',
        'console.log(',
        '  JSON.stringify({',
        '    className: Widget.name,',
        '    sameClassObject:',
        `      Widget === ${ENTITY_INDEX_EXPORT}['widgets'].find((entity) => entity.name === 'Widget'),`,
        '    row: { id: row.id, sku: row.sku },',
        '    refusedWith: refused,',
        '  }),',
        ');',
      ].join('\n'),
      'utf8',
    );

    // `--experimental-strip-types` explicitly, though every Node this repository
    // supports strips types without it: the flag is accepted from 22.18 (the CI
    // image) through 26 (a developer's machine), so naming it makes the run
    // independent of *when* stripping became the default rather than of whether
    // it is available.
    const stdout = execFileSync(process.execPath, ['--experimental-strip-types', driver], {
      cwd: root,
      encoding: 'utf8',
      // No inherited module resolution: `NODE_PATH` set by whatever ran this
      // would let the fixture resolve a package it does not have.
      env: { ...process.env, NODE_PATH: '' },
    });

    expect(JSON.parse(stdout.trim())).toEqual({
      className: 'Widget',
      sameClassObject: true,
      row: { id: 'w-1', sku: 'SKU-1' },
      // The index's keys, which is the set this host installed — and the proof
      // that the refusal names them rather than reporting `undefined`.
      refusedWith: ['billing', 'widgets'],
    });
  });
});
