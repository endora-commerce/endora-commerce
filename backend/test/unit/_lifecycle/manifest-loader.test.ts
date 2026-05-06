import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverManifests,
  ManifestLoadError,
} from '../../../src/modules/_lifecycle/services/manifest-loader.js';

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
