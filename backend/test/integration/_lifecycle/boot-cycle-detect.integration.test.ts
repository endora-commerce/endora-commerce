import { describe, expect, it } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverManifests,
  ManifestLoadError,
} from '../../../src/lifecycle/services/manifest-loader.js';

/**
 * Integration test for FR-017 — boot refuses on cycle (US4).
 *
 * The manifest loader builds the dependency graph from the on-disk
 * fixture tree and MUST refuse with a clear cycle error naming the
 * modules involved.
 *
 * Uses the shared cyclic-graph fixture in
 * `backend/test/fixtures/manifests/cyclic-graph/{a,b}/manifest.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cyclicRoot = resolve(here, '../../fixtures/manifests/cyclic-graph');

describe('Boot — cycle detection (integration)', () => {
  it('refuses to load a fixture tree containing a cycle, naming both modules', async () => {
    let caught: ManifestLoadError | null = null;
    try {
      await discoverManifests({ modulesRoot: cyclicRoot });
    } catch (err) {
      if (err instanceof ManifestLoadError) caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught?.kind).toBe('cycle');
    expect(caught?.message).toMatch(/a/);
    expect(caught?.message).toMatch(/b/);
  });
});
