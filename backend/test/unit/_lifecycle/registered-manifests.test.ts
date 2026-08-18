import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@b2b/contracts';
import type { DiscoveredManifestEntry } from '../../../src/modules/_lifecycle/manifest-index.generated.js';
import {
  REGISTERED_MANIFESTS,
  coreManifestEntries,
  resolvedManifestEntries,
} from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * `REGISTERED_MANIFESTS` is a derivation of the generated manifest index, not a
 * second enumeration of it (feature 071, F2).
 *
 * Both files used to import the same manifests statically, refreshed by two
 * different commands, and only a full build ran both — so one could name a
 * module directory the other had already lost. The two facts the second file
 * carried are derivable: a core module's `filePath` is its id under the modules
 * root, and its install hooks are exports of the manifest the index already
 * imports.
 *
 * Since D-104 the index is **bare core under every value of `DEPLOYMENT`**, so
 * there is no overlay entry in it to filter and no per-deployment `filePath` to
 * reconstruct from it. The deployment half is a runtime discovery, and
 * `resolvedManifestEntries()` is the one implementation of it — there used to be
 * two, and the one under test was not the one that ran.
 *
 * The derivation cases run on synthetic entries rather than the real index: the
 * real tree has few hooks, so a test reading it could not tell a working
 * derivation from one that dropped hooks entirely.
 */

const manifestOf = (id: string): ModuleManifest => ({
  id,
  name: id,
  version: '1.0.0',
  dependencies: [],
});

const noop = async (): Promise<void> => {};

const BLOG: DiscoveredManifestEntry = { id: 'blog', manifest: manifestOf('blog') };
const CMS: DiscoveredManifestEntry = { id: 'cms', manifest: manifestOf('cms') };
const HOOKED: DiscoveredManifestEntry = {
  id: 'custom_fields',
  manifest: manifestOf('custom_fields'),
  installHook: noop,
  uninstallHook: noop,
};

describe('coreManifestEntries — the core registry, derived', () => {
  it('carries one entry per core module, in index order', () => {
    const entries = coreManifestEntries([BLOG, CMS]);
    expect(entries.map((e) => e.manifest.id)).toEqual(['blog', 'cms']);
  });

  it('derives filePath from the id — the module manifest under the core modules root', () => {
    const [entry] = coreManifestEntries([BLOG]);
    expect(entry?.filePath).toMatch(/backend[/\\]src[/\\]modules[/\\]blog[/\\]manifest\.ts$/);
  });

  it('carries the install and uninstall hooks the index detected', () => {
    const [entry] = coreManifestEntries([HOOKED]);
    expect(entry?.installHook).toBe(noop);
    expect(entry?.uninstallHook).toBe(noop);
  });

  it('omits a hook key a module does not export, rather than setting it undefined', () => {
    const [entry] = coreManifestEntries([BLOG]);
    expect(entry && 'installHook' in entry).toBe(false);
    expect(entry && 'uninstallHook' in entry).toBe(false);
  });
});

describe('the committed index is bare core, whatever DEPLOYMENT was set to (D-104)', () => {
  it('holds no deployment’s module', () => {
    // FR-004 by construction rather than by filtering: the generator no longer
    // has an overlay branch to walk, so there is nothing here to leave out.
    expect(REGISTERED_MANIFESTS.map((e) => e.manifest.id)).not.toContain('example_overlay');
  });
});

describe('resolvedManifestEntries — the deployment-resolved set, discovered at runtime', () => {
  it('adds the deployment’s overlay module, with its filePath under the deployment root', async () => {
    const resolved = await resolvedManifestEntries({ DEPLOYMENT: 'example' } as NodeJS.ProcessEnv);
    const entry = resolved.find((e) => e.manifest.id === 'example_overlay');
    expect(entry).toBeDefined();
    expect(entry?.filePath).toMatch(
      /backend[/\\]src[/\\]apps[/\\]example[/\\]modules[/\\]example_overlay[/\\]manifest\.ts$/,
    );
  });

  it('keeps every core entry exactly once, and appends the deployment’s', async () => {
    const resolved = await resolvedManifestEntries({ DEPLOYMENT: 'example' } as NodeJS.ProcessEnv);
    const ids = resolved.map((e) => e.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, REGISTERED_MANIFESTS.length)).toEqual(
      REGISTERED_MANIFESTS.map((e) => e.manifest.id),
    );
    expect(ids).toContain('example_overlay');
  });

  it('returns the core registry unchanged for a bare-core build (FR-008)', async () => {
    const resolved = await resolvedManifestEntries({} as NodeJS.ProcessEnv);
    expect(resolved).toEqual([...REGISTERED_MANIFESTS]);
  });

  it('reads the deployment from its argument, so one process can resolve both', async () => {
    // The property the harness depends on: a suite proves the module present
    // with the deployment selected and absent without it, in one run. An
    // ambient `DEPLOYMENT` read at import time could answer only one of them.
    const withDeployment = await resolvedManifestEntries({
      DEPLOYMENT: 'example',
    } as NodeJS.ProcessEnv);
    const bareCore = await resolvedManifestEntries({} as NodeJS.ProcessEnv);
    expect(withDeployment.length).toBe(bareCore.length + 1);
  });
});
