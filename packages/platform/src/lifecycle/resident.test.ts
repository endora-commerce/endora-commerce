import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { manifest } from './manifest.js';
import { platformResidentManifestEntries } from './resident.js';
import { resolveManifestEntries } from './manifest-registry.js';

/**
 * `_lifecycle` arrives with the platform (`specs/110-instance-repository/`
 * T141).
 *
 * The red proof is the acceptance criterion's: an instance ships no generated
 * manifest index, so it passes `core: []` — and before this the boot refused
 * with `not-shipped: _lifecycle`, needed by five modules of the set the command
 * itself writes.
 */
describe('platformResidentManifestEntries', () => {
  it('carries `_lifecycle`, as core', () => {
    const entries = platformResidentManifestEntries();
    expect(entries.map((entry) => entry.manifest.id)).toEqual([manifest.id]);
    expect(entries[0]!.origin).toBe('core');
  });

  it('anchors on a directory that really holds the module i18n bundles', () => {
    // Every consumer takes `dirname` and joins `i18n.bundlesDir`; the `_i18n`
    // boot reconciler *logs and skips* a directory that is not there, so a
    // plausible-but-wrong path is a module serving raw keys with nothing
    // thrown. The declared directory is read from the manifest rather than
    // spelled here.
    const bundlesDir = manifest.i18n?.bundlesDir;
    expect(bundlesDir).toBeDefined();
    const own = dirname(platformResidentManifestEntries()[0]!.filePath);
    expect(existsSync(join(own, bundlesDir!, 'en.json'))).toBe(true);
    expect(existsSync(join(own, bundlesDir!, 'pl.json'))).toBe(true);
  });
});

describe('resolveManifestEntries', () => {
  it('yields `_lifecycle` for a composition whose core registry is empty', async () => {
    const entries = await resolveManifestEntries({
      core: [],
      overlay: async () => [],
      packages: async () => [],
    });
    expect(entries.map((entry) => entry.manifest.id)).toContain('_lifecycle');
  });

  it('lets a host that names it win, without reporting a module-id collision', async () => {
    const hosts = platformResidentManifestEntries().map((entry) => ({
      ...entry,
      filePath: '/a/host/index.js',
    }));
    const entries = await resolveManifestEntries({
      core: hosts,
      overlay: async () => [],
      packages: async () => [],
    });
    const found = entries.filter((entry) => entry.manifest.id === '_lifecycle');
    expect(found).toHaveLength(1);
    expect(found[0]!.filePath).toBe('/a/host/index.js');
  });
});
