import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIRST_PARTY_MODULE_PACKAGES } from './first-party-modules.generated.js';
import { packageModuleEntriesUnder } from './package-runtime.js';

/**
 * `specs/189-command-middleware/` T040 (FR-004, `contracts/module-origin.md`
 * §2, D-296.8): the package loader stamps each installed module's trust tier.
 * `core` only when **both** the installed package's own `package.json` `name`
 * and its `endora.id` are one entry of the release's first-party list;
 * `package` for everything else — an npm alias, an id borrowed under another
 * name, and a paid module whatever its scope. `installedPackageName` is the
 * installed package's own name, so an alias shows the real one.
 */

let root: string;
let counter = 0;

function writePackage(options: { readonly dir: string; readonly name: string; readonly id: string }): string {
  const instance = join(root, `instance-${counter++}`);
  const dir = join(instance, 'node_modules', ...options.dir.split('/'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: options.name,
      version: '1.2.3',
      type: 'module',
      endora: { type: 'module', id: options.id, platform: '0.x' },
      exports: { '.': './dist/manifest.js', './backend': './dist/backend.js', './package.json': './package.json' },
    }),
  );
  writeFileSync(
    join(dir, 'dist', 'manifest.js'),
    `export const manifest = ${JSON.stringify({ id: options.id, name: options.id, version: '1.2.3', dependencies: [] })};\n`,
  );
  writeFileSync(join(dir, 'dist', 'backend.js'), 'export function registerModule() {}\n');
  return join(instance, 'node_modules');
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'package-origin-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const firstParty = FIRST_PARTY_MODULE_PACKAGES[0]!;

describe('the package loader stamps the module origin (189 T040)', () => {
  it('has a first-party list to match against', () => {
    expect(FIRST_PARTY_MODULE_PACKAGES.length).toBeGreaterThan(0);
    expect(firstParty.packageName.startsWith('@endora-commerce/')).toBe(true);
  });

  it('gives core to a first-party name and id, keeping installedPackage', async () => {
    const roots = [writePackage({ dir: firstParty.packageName, name: firstParty.packageName, id: firstParty.moduleId })];
    const [entry] = await packageModuleEntriesUnder(roots);
    expect(entry).toMatchObject({
      id: firstParty.moduleId,
      origin: 'core',
      installedPackage: true,
      installedPackageName: firstParty.packageName,
    });
  });

  it('gives package to an alias whose own name differs, and shows the real name', async () => {
    // `"<first-party name>": "npm:acme-lookalike@1"` installs under the
    // first-party directory a package whose own name is `acme-lookalike`. The
    // loader resolves a package by its own name, so the alias composes only
    // where that name resolves too — which is the case that could borrow a tier.
    const nodeModules = writePackage({ dir: firstParty.packageName, name: 'acme-lookalike', id: firstParty.moduleId });
    const real = join(nodeModules, 'acme-lookalike');
    mkdirSync(join(real, 'dist'), { recursive: true });
    for (const file of ['package.json', 'dist/manifest.js', 'dist/backend.js']) {
      writeFileSync(join(real, file), readFileSync(join(nodeModules, ...firstParty.packageName.split('/'), file)));
    }
    const entries = await packageModuleEntriesUnder([nodeModules]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: firstParty.moduleId, origin: 'package', installedPackageName: 'acme-lookalike' });
  });

  it('gives package to a first-party id under a name that is not its own', async () => {
    const roots = [writePackage({ dir: '@acme/mod-borrowed', name: '@acme/mod-borrowed', id: firstParty.moduleId })];
    const [entry] = await packageModuleEntriesUnder(roots);
    expect(entry).toMatchObject({ origin: 'package' });
  });

  it('gives package to a paid module, whatever its scope (D-296.8)', async () => {
    const roots = [
      writePackage({ dir: '@endora-commerce/mod-acme-paid', name: '@endora-commerce/mod-acme-paid', id: 'acme_paid' }),
    ];
    const [entry] = await packageModuleEntriesUnder(roots);
    expect(entry).toMatchObject({ id: 'acme_paid', origin: 'package', installedPackageName: '@endora-commerce/mod-acme-paid' });
  });
});
