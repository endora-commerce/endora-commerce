import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverManifests,
  folderNameFromPath,
  ManifestLoadError,
} from '../../../src/lifecycle/services/manifest-loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = resolve(here, '../../fixtures/manifests');

describe('discoverManifests', () => {
  it('loads a 3-module DAG fixture', async () => {
    const root = resolve(fixturesRoot, 'basic-graph');
    const result = await discoverManifests({ modulesRoot: root });
    expect([...result.modules.keys()].sort()).toEqual([
      'blog',
      'sales_channels',
      'settings',
    ]);
    expect(result.graph.hasCycle()).toBeNull();
    const order = result.graph.topologicalOrder();
    expect(order.indexOf('settings')).toBeLessThan(order.indexOf('sales_channels'));
    expect(order.indexOf('sales_channels')).toBeLessThan(order.indexOf('blog'));
  });

  it('refuses a cyclic fixture with the cycle named in the error', async () => {
    const root = resolve(fixturesRoot, 'cyclic-graph');
    await expect(discoverManifests({ modulesRoot: root })).rejects.toBeInstanceOf(
      ManifestLoadError,
    );
    try {
      await discoverManifests({ modulesRoot: root });
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestLoadError);
      expect((err as ManifestLoadError).kind).toBe('cycle');
      expect((err as Error).message).toMatch(/a/);
      expect((err as Error).message).toMatch(/b/);
    }
  });

  it('topo-sorts a 6-element chain in dependency order', async () => {
    const root = resolve(fixturesRoot, 'deep-graph');
    const result = await discoverManifests({ modulesRoot: root });
    const order = result.graph.topologicalOrder();
    // m1 has no deps; m6 depends transitively on all the rest.
    expect(order[0]).toBe('m1');
    expect(order[order.length - 1]).toBe('m6');
  });

  it('attaches install/uninstall hooks when present in the manifest module', async () => {
    // The fixture manifests don't export hooks, so we just verify the
    // loader doesn't accidentally synthesise empty function fields.
    const root = resolve(fixturesRoot, 'basic-graph');
    const result = await discoverManifests({ modulesRoot: root });
    for (const entry of result.modules.values()) {
      expect(entry.installHook).toBeUndefined();
      expect(entry.uninstallHook).toBeUndefined();
    }
  });
});

/**
 * The folder-name identity rule, scoped to the origin it is a rule about
 * (feature 080, T032).
 *
 * `discoverManifests` derives a module's identity from its **directory name**
 * and refuses a manifest that disagrees. That is Principle VI over a tree this
 * repository owns, and it is right there. It is not right anywhere else: an
 * installed package's directory is its npm name — `@endora-commerce/mod-blog`
 * — and its identity is `endora.id` (D-142), checked against the manifest in
 * `src/packages/package-runtime.ts`. Nothing reaches this loader with a package
 * today, and the failure mode if something ever did is the worst kind: a
 * `folder-id-mismatch` blaming a vendor for naming their package correctly.
 * So the loader refuses the *root*, with the instruction, instead.
 */
describe('discoverManifests — identity is the folder name, and that scopes it', () => {
  it('refuses a modulesRoot inside node_modules and names the loader that owns it', async () => {
    const root = resolve(fixturesRoot, 'basic-graph');
    // A path shaped like an instance's installed packages. It does not need to
    // exist: the refusal is about what the caller asked for, and it has to
    // land before the walk so that a real `node_modules` cannot be read as a
    // modules tree at all.
    const nodeModulesRoot = resolve(root, '..', 'node_modules');
    await expect(discoverManifests({ modulesRoot: nodeModulesRoot })).rejects.toBeInstanceOf(
      ManifestLoadError,
    );
    try {
      await discoverManifests({ modulesRoot: nodeModulesRoot });
      expect.unreachable('a node_modules root must be refused');
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestLoadError);
      expect((err as ManifestLoadError).kind).toBe('package-root');
      expect((err as Error).message).toContain('endora.id');
      expect((err as Error).message).toContain('loadPackageModuleEntries');
    }
  });

  it('folderNameFromPath refuses a package.json anchor rather than answering wrongly', () => {
    // A package entry's `filePath` is its resolved `package.json`, so
    // `basename(dirname(...))` answers `mod-blog` — the tail of an npm name,
    // which is not the module id and is not scoped by the `@scope` that makes
    // it unique. Answering that is worse than refusing.
    expect(() =>
      folderNameFromPath('/srv/app/node_modules/@endora-commerce/mod-blog/package.json'),
    ).toThrow(/package\.json/);
    expect(folderNameFromPath('/srv/app/src/modules/blog/manifest.ts')).toBe('blog');
  });
});
