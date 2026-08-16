import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@b2b/contracts';
import type { DiscoveredManifestEntry } from '../../../src/modules/_lifecycle/manifest-index.generated.js';
import {
  coreManifestEntries,
  mergeOverlayManifestEntries,
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
 * imports. What is *not* derivable is an overlay module's `filePath`, because it
 * depends on the deployment the process runs as; that stays a runtime merge.
 *
 * These run on synthetic entries rather than the real index: the real tree has
 * one hook on one module and no overlay module in the committed (bare-core)
 * index, so a test reading it could not tell a working derivation from one that
 * dropped hooks and overlay modules entirely.
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
const OVERLAY_ONLY: DiscoveredManifestEntry = {
  id: 'example_overlay',
  manifest: manifestOf('example_overlay'),
  overlay: true,
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

  it('leaves overlay modules out, so the core registry stays deployment-free (FR-004)', () => {
    const entries = coreManifestEntries([BLOG, OVERLAY_ONLY]);
    expect(entries.map((e) => e.manifest.id)).toEqual(['blog']);
  });
});

describe('mergeOverlayManifestEntries — the deployment-resolved set', () => {
  const discovered = [BLOG, OVERLAY_ONLY];
  const coreEntries = coreManifestEntries(discovered);

  it('adds the overlay module, resolving its filePath under the deployment root', () => {
    const resolved = mergeOverlayManifestEntries(coreEntries, discovered, 'example');
    const entry = resolved.find((e) => e.manifest.id === 'example_overlay');
    expect(entry?.filePath).toMatch(
      /backend[/\\]src[/\\]apps[/\\]example[/\\]modules[/\\]example_overlay[/\\]manifest\.ts$/,
    );
  });

  it('carries an overlay module hook too', () => {
    const resolved = mergeOverlayManifestEntries(coreEntries, discovered, 'example');
    expect(resolved.find((e) => e.manifest.id === 'example_overlay')?.uninstallHook).toBe(noop);
  });

  it('keeps every core entry exactly once', () => {
    const resolved = mergeOverlayManifestEntries(coreEntries, discovered, 'example');
    expect(resolved.map((e) => e.manifest.id)).toEqual(['blog', 'example_overlay']);
  });

  it('returns the core entries unchanged for a bare-core build', () => {
    const bareCore = [BLOG, CMS];
    const entries = coreManifestEntries(bareCore);
    expect(mergeOverlayManifestEntries(entries, bareCore, null)).toEqual(entries);
  });

  it('does not let an overlay of a core id arrive twice through the merge', () => {
    // The index imports one manifest per id, so a shadowing overlay never
    // duplicates an entry: whatever it carries for an id the core registry
    // already holds is skipped.
    const shadowing: DiscoveredManifestEntry[] = [BLOG, { ...BLOG, overlay: true }];
    const entries = coreManifestEntries(shadowing);
    const resolved = mergeOverlayManifestEntries(entries, shadowing, 'example');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.filePath).toMatch(/src[/\\]modules[/\\]blog[/\\]manifest\.ts$/);
  });
});
