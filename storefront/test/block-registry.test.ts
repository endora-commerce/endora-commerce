import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  analyseBlockPackages,
  discoverBlockPackages,
  renderBlockRegistry,
  renderBlockStylesheet,
} from '../scripts/block-discovery.mjs';
import { discoverThemePackages, listInstalledPackages } from '../scripts/theme-discovery.mjs';

/**
 * `blocks:generate` — `specs/141-module-block-renderers/contracts/block-renderers.md`
 * §5.2: this storefront discovers the module packages **it** has installed that
 * publish a storefront layer and/or a block stylesheet, and writes the registry
 * and the stylesheet aggregate from that one walk.
 *
 * Every case runs over a fixture `node_modules` on disk — the top of the
 * analysis — and the generator itself is spawned, because what a storefront
 * owner runs is the script and not a function of it.
 */

const GENERATOR = fileURLToPath(new URL('../scripts/generate-blocks.mjs', import.meta.url));
const STOREFRONT = fileURLToPath(new URL('..', import.meta.url));
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

interface FixturePackage {
  readonly name: string;
  readonly endora?: unknown;
  readonly exports?: Record<string, unknown>;
  readonly files?: Record<string, string>;
}

function fixture(packages: readonly FixturePackage[]): string {
  const root = mkdtempSync(join(tmpdir(), 'sf-blocks-'));
  scratch.push(root);
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  for (const pkg of packages) {
    const dir = join(root, 'node_modules', pkg.name);
    write(
      join(dir, 'package.json'),
      JSON.stringify({
        name: pkg.name,
        version: '1.0.0',
        ...(pkg.endora !== undefined ? { endora: pkg.endora } : {}),
        ...(pkg.exports !== undefined ? { exports: pkg.exports } : {}),
      }),
    );
    for (const [file, content] of Object.entries(pkg.files ?? {})) write(join(dir, file), content);
  }
  return join(root, 'node_modules');
}

const STOREFRONT_LAYER = {
  './storefront': { types: './dist/storefront/index.d.ts', default: './dist/storefront/index.js' },
};
const LAYER_FILE = {
  'dist/storefront/index.js': 'export const contributions = {};\n',
  'dist/storefront/index.d.ts': 'export declare const contributions: {};\n',
};

const both: FixturePackage = {
  name: '@acme/mod-crm',
  endora: { type: 'module', id: 'crm' },
  exports: { '.': './dist/manifest.js', ...STOREFRONT_LAYER, './blocks.css': './dist/blocks.css' },
  files: { ...LAYER_FILE, 'dist/blocks.css': '.crm-badge{color:red}\n' },
};
const layerOnly: FixturePackage = {
  name: '@acme/mod-loyalty',
  endora: { type: 'module', id: 'loyalty' },
  exports: { '.': './dist/manifest.js', ...STOREFRONT_LAYER },
  files: LAYER_FILE,
};
const notAModule: FixturePackage = {
  name: 'some-ui-kit',
  exports: { ...STOREFRONT_LAYER, './blocks.css': './blocks.css' },
  files: { ...LAYER_FILE, 'blocks.css': '.x{}\n' },
};
const backendOnly: FixturePackage = {
  name: '@acme/mod-orders',
  endora: { type: 'module', id: 'orders' },
  exports: { '.': './dist/manifest.js', './backend': './dist/backend/index.js' },
};

describe('the installed-package walk is shared with theme discovery (plan D5)', () => {
  it('lists every direct package once, scoped ones included, sorted', () => {
    const nodeModules = fixture([both, layerOnly, notAModule]);
    const { packages, filesRead } = listInstalledPackages(nodeModules);
    expect(packages.map((pkg) => pkg.name)).toEqual([
      '@acme/mod-crm',
      '@acme/mod-loyalty',
      'some-ui-kit',
    ]);
    expect(filesRead).toBe(3);
  });

  it('still answers the theme question from the same walk', () => {
    const nodeModules = fixture([
      both,
      { name: 'acme-theme', endora: { themes: ['acme'] }, exports: { './theme.css': './theme.css' } },
    ]);
    const themes = discoverThemePackages(nodeModules);
    expect(themes.packages.map((pkg) => pkg.name)).toEqual(['acme-theme']);
    expect(themes.packages[0]?.specifier).toBe('acme-theme/theme.css');
    expect(themes.filesRead).toBe(2);
  });
});

describe('discoverBlockPackages', () => {
  it('selects module packages by their own endora block and exports map', () => {
    const { packages } = discoverBlockPackages(fixture([both, layerOnly, notAModule, backendOnly]));
    expect(packages).toEqual([
      {
        name: '@acme/mod-crm',
        moduleId: 'crm',
        storefront: '@acme/mod-crm/storefront',
        stylesheet: '@acme/mod-crm/blocks.css',
      },
      {
        name: '@acme/mod-loyalty',
        moduleId: 'loyalty',
        storefront: '@acme/mod-loyalty/storefront',
        stylesheet: null,
      },
    ]);
  });

  it('registers nothing from a non-module package that declares the same subpaths, and says so', () => {
    const { packages, findings, notes } = discoverBlockPackages(fixture([notAModule]));
    expect(packages).toEqual([]);
    // Not a refusal: the build goes on. But a module package whose manifest
    // lost its `endora` block must not become placeholders without a word.
    expect(findings).toEqual([]);
    expect(notes.map((note) => note.package)).toEqual(['some-ui-kit']);
    expect(notes[0]?.message).toContain('endora');
  });

  it('says nothing about a package that declares neither subpath', () => {
    expect(discoverBlockPackages(fixture([backendOnly, { name: 'left-pad' }])).notes).toEqual([]);
  });

  it('refuses a sources-shipping module with src/storefront and no ./storefront subpath', () => {
    const { findings } = discoverBlockPackages(
      fixture([
        {
          name: '@acme/mod-crm',
          endora: { type: 'module', id: 'crm' },
          exports: { '.': './dist/manifest.js' },
          files: { 'src/storefront/index.ts': 'export const contributions = {};\n' },
        },
      ]),
    );
    expect(findings.map((finding) => finding.finding)).toEqual(['layer-without-subpath']);
    expect(findings[0]?.message).toContain('@acme/mod-crm');
  });

  it('refuses a declared subpath whose file is not in the package', () => {
    const { findings } = discoverBlockPackages(
      fixture([
        {
          name: '@acme/mod-crm',
          endora: { type: 'module', id: 'crm' },
          exports: { ...STOREFRONT_LAYER, './blocks.css': './dist/blocks.css' },
        },
      ]),
    );
    expect(findings.map((finding) => finding.finding).sort()).toEqual([
      'missing-layer-file',
      'missing-layer-file',
    ]);
  });

  it('refuses a storefront layer that ships no type declarations', () => {
    // Found by the acceptance criterion: `next build` fails with TS7016 on the
    // generated registry's import, which names neither the package's author nor
    // the remedy. The generator says both.
    const { packages, findings } = discoverBlockPackages(
      fixture([
        {
          ...layerOnly,
          files: { 'dist/storefront/index.js': 'export const contributions = {};\n' },
        },
      ]),
    );
    expect(packages).toEqual([]);
    expect(findings.map((finding) => finding.finding)).toEqual(['untyped-layer']);
  });

  it('accepts declarations found beside the target, with no types condition', () => {
    const { packages, findings } = discoverBlockPackages(
      fixture([{ ...layerOnly, exports: { './storefront': './dist/storefront/index.js' } }]),
    );
    expect(findings).toEqual([]);
    expect(packages.map((pkg) => pkg.storefront)).toEqual(['@acme/mod-loyalty/storefront']);
  });

  it('refuses two packages claiming one module id', () => {
    const { packages } = discoverBlockPackages(
      fixture([both, { ...layerOnly, name: '@other/mod-crm', endora: { type: 'module', id: 'crm' } }]),
    );
    expect(analyseBlockPackages(packages).map((finding) => finding.finding)).toEqual([
      'duplicate-module',
    ]);
  });
});

describe('the two artefacts', () => {
  it('names each storefront layer by its bare specifier, sorted by module id', () => {
    const { packages } = discoverBlockPackages(fixture([layerOnly, both]));
    const registry = renderBlockRegistry(packages);
    expect(registry).toContain(
      "import { contributions as contributions0 } from '@acme/mod-crm/storefront';",
    );
    expect(registry).toContain(
      "import { contributions as contributions1 } from '@acme/mod-loyalty/storefront';",
    );
    expect(registry.indexOf("moduleId: 'crm'")).toBeLessThan(registry.indexOf("moduleId: 'loyalty'"));
    const stylesheet = renderBlockStylesheet(packages);
    expect(stylesheet).toContain("@import '@acme/mod-crm/blocks.css';");
    expect(stylesheet).not.toContain('mod-loyalty');
  });

  it('is deterministic: the same population renders the same bytes', () => {
    const forward = discoverBlockPackages(fixture([both, layerOnly])).packages;
    const backward = discoverBlockPackages(fixture([layerOnly, both])).packages;
    expect(renderBlockRegistry(forward)).toBe(renderBlockRegistry(backward));
    expect(renderBlockStylesheet(forward)).toBe(renderBlockStylesheet(backward));
  });

  it('renders the committed files for the empty population, byte for byte', () => {
    // This repository's storefront depends on no module package, so the two
    // committed artefacts are the empty registry — and stay generated rather
    // than hand-written, which is what this holds.
    expect(renderBlockRegistry([])).toBe(
      readFileSync(join(STOREFRONT, 'lib', 'page-builder', 'blocks.generated.ts'), 'utf8'),
    );
    expect(renderBlockStylesheet([])).toBe(
      readFileSync(join(STOREFRONT, 'app', 'blocks.generated.css'), 'utf8'),
    );
  });
});

describe('the generator, as a storefront owner runs it', () => {
  function run(nodeModules: string): { status: number | null; out: string; root: string } {
    const root = join(nodeModules, '..');
    mkdirSync(join(root, 'lib', 'page-builder'), { recursive: true });
    mkdirSync(join(root, 'app'), { recursive: true });
    const result = spawnSync(process.execPath, [GENERATOR, '--root', root], { encoding: 'utf8' });
    return { status: result.status, out: `${result.stdout}${result.stderr}`, root };
  }

  it('writes both artefacts and says what it read', () => {
    const { status, out, root } = run(fixture([both, layerOnly, notAModule]));
    expect(status).toBe(0);
    expect(out).toContain('[blocks:generate] wrote: modules=2 layers=2 stylesheets=1');
    expect(out).toContain('[blocks:generate] note: package "some-ui-kit"');
    expect(readFileSync(join(root, 'lib', 'page-builder', 'blocks.generated.ts'), 'utf8')).toContain(
      '@acme/mod-crm/storefront',
    );
    expect(readFileSync(join(root, 'app', 'blocks.generated.css'), 'utf8')).toContain(
      "@import '@acme/mod-crm/blocks.css';",
    );
  });

  it('refuses, and writes nothing, when a package cannot be composed', () => {
    const { status, out } = run(
      fixture([
        {
          name: '@acme/mod-crm',
          endora: { type: 'module', id: 'crm' },
          exports: { '.': './dist/manifest.js' },
          files: { 'src/storefront/index.ts': 'export const contributions = {};\n' },
        },
      ]),
    );
    expect(status).toBe(1);
    expect(out).toContain('layer-without-subpath');
  });

  it('exits 2 when there is no node_modules to walk', () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-blocks-empty-'));
    scratch.push(root);
    const result = spawnSync(process.execPath, [GENERATOR, '--root', root], { encoding: 'utf8' });
    expect(result.status).toBe(2);
  });
});
