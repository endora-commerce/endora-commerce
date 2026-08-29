import { describe, expect, it } from 'vitest';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { buildStaticRegistry } from '../../../src/lifecycle/services/static-registry.js';

/**
 * Integration test for FR-002 — boot refuses on duplicate id (US4).
 *
 * Tested at the `buildStaticRegistry` layer, which is what
 * `composition.ts` calls at boot. Two manifest entries with the same
 * `id` MUST throw before the lifecycle plugin starts.
 *
 * Filesystem-side duplicate-id is harder to exercise because the
 * loader's folder-name === id check fires first; the static-registry
 * path here is the equivalent guard for the production composition.
 */

describe('Boot — duplicate id detection (integration)', () => {
  it('throws when two manifest entries declare the same id', () => {
    const a = defineModuleManifest({
      id: 'fixture_dup',
      name: 'Dup A',
      version: '1.0.0',
      dependencies: [],
    });
    // Constructed via the schema-only path so the helper's own
    // single-call self-check doesn't reject upfront.
    const b = defineModuleManifest({
      id: 'fixture_dup',
      name: 'Dup B',
      version: '1.0.1',
      dependencies: [],
    });

    expect(() =>
      buildStaticRegistry([
        { manifest: a },
        { manifest: b },
      ]),
    ).toThrow(/duplicate manifest id/i);
  });
});
